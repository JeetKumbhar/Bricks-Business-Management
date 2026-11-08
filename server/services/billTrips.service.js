import mongoose from "mongoose";
import { BILL_HISTORY, BILL_STATUS, LIMITS } from "../constants/bill.js";
import { BILLING_STATUS } from "../constants/billing.js";
import { CUSTOMER_KIND, INTERNAL_CUSTOMER_NAME } from "../constants/customer.js";
import Bill from "../models/Bill.js";
import Customer from "../models/Customer.js";
import TruckTrip from "../models/TruckTrip.js";
import ApiError from "../utils/ApiError.js";
import { parseMilli } from "../utils/billRules.js";
import { runInTransaction } from "../utils/transaction.js";
import { pricingUnitFor } from "./billCalculations.js";
import { actorOf, compute, conflictDraftOnly, createDraft, historyRow, load, toBillDto } from "./bill.service.js";
import { assertCustomersActive, customerSnapshot } from "./customer.service.js";
import { loadSettings } from "./invoiceSettings.service.js";
import { releaseTrips, reserveTrips } from "./tripBilling.service.js";
import { tripDtos } from "./truckTrip.service.js";

// Draft bills made from Pheeras. Rules:
//  - Only UNBILLED Pheeras of ONE active, normal customer. NOT_BILLABLE (Internal / No Bill), historical (no customer), RESERVED and
//    BILLED Pheeras are refused HERE on the server, whatever the screen offered.
//  - One line per Pheera, with its own quantity and unit. Bricks are priced per 1,000, everything else per tonne. Rate, HSN and tax rate
//    start blank: the owner fills them before finalizing (the existing finalize checks block a line without them).
//  - The Pheeras are reserved by ONE conditional update (UNBILLED -> RESERVED) before the draft is written; if fewer than expected match,
//    nothing is created. All inside runInTransaction (Atlas); on a standalone MongoDB the code undoes exactly what it reserved.
//  - requestId makes "Generate" safe to repeat: the same request returns the draft it already made.
const label = (t) => `Pheera ${t.pheeraNo} of ${t.truckNumber} on ${t.businessDate}`;
const shortDate = (d) => d.split("-").reverse().join("-");
const isDuplicateKey = (err) => err?.code === 11000;
const conflictList = (message, errors) => ApiError.conflict(message, errors.map((m) => ({ field: "tripIds", message: m })));

export const tripLine = (t) => ({
  particulars: `${t.materialName} - Truck ${t.truckNumber} - to ${t.destination} - ${shortDate(t.businessDate)} (Pheera ${t.pheeraNo})`.slice(0, LIMITS.particulars),
  hsn: "", quantityMilli: parseMilli(t.quantity), unit: t.unit, ratePaise: 0, taxRateBp: null, pricingUnit: pricingUnitFor(t.materialCategory),
  sourceTripId: String(t._id),
  source: { pheeraNo: t.pheeraNo, truckNumber: t.truckNumber, businessDate: t.businessDate, materialName: t.materialName, destination: t.destination, quantity: t.quantity, unit: t.unit },
});

const sortTrips = (rows) => [...rows].sort((a, b) => a.businessDate.localeCompare(b.businessDate) || a.truckNumber.localeCompare(b.truckNumber) || a.pheeraNo - b.pheeraNo);

/** Loads and checks the Pheeras. Returns { trips (in invoice order), customer }. Throws 404/409 naming every problem. */
const loadEligible = async (tripIds, { customerId = null } = {}) => {
  const ids = tripIds.map(String);
  if (new Set(ids).size !== ids.length) throw ApiError.badRequest("Validation failed", [{ field: "tripIds", message: "The same Pheera is listed twice" }]);
  const rows = await TruckTrip.find({ _id: { $in: ids } }).lean();
  const found = new Map(rows.map((r) => [String(r._id), r]));
  const missing = ids.filter((i) => !found.has(i));
  if (missing.length) throw ApiError.notFound(`Pheera not found: ${missing.join(", ")}`);
  const billIds = [...new Set(rows.filter((r) => r.billId).map((r) => String(r.billId)))];
  const bills = new Map((billIds.length ? await Bill.find({ _id: { $in: billIds } }).lean() : []).map((b) => [String(b._id), b]));
  const problems = [];
  for (const t of rows) {
    if (t.isDeleted) problems.push(`${label(t)} is voided`);
    else if (t.billingStatus === BILLING_STATUS.NOT_BILLABLE) problems.push(`${label(t)} is internal / no-bill and can never be put on an invoice`);
    else if (!t.billingStatus || !t.customerId) problems.push(`${label(t)} has no customer. Assign a customer to it first`);
    else if (t.billingStatus === BILLING_STATUS.RESERVED) problems.push(`${label(t)} is already in a draft bill`);
    else if (t.billingStatus === BILLING_STATUS.BILLED) problems.push(`${label(t)} is already billed on invoice ${bills.get(String(t.billId))?.billNumber ?? ""}`.trim());
  }
  if (problems.length) throw conflictList("Some Pheeras cannot be billed", problems);
  const customers = [...new Set(rows.map((r) => String(r.customerId)))];
  if (customers.length > 1) throw conflictList("Pheeras of different customers cannot be on one bill", [`Selected Pheeras belong to ${customers.length} different customers`]);
  if (customerId && customers[0] !== String(customerId)) throw conflictList("These Pheeras belong to a different customer than this draft", rows.map(label));
  const [customer] = await Customer.find({ _id: customers[0] }).lean();
  if (!customer) throw ApiError.conflict("The customer of these Pheeras no longer exists");
  if (customer.kind === CUSTOMER_KIND.INTERNAL) throw ApiError.conflict(`"${INTERNAL_CUSTOMER_NAME}" Pheeras can never be put on an invoice`);
  if (customer.isDeleted) throw ApiError.conflict(`Customer "${customer.name}" is archived. Restore the customer first`);
  return { trips: sortTrips(rows), customer };
};

const withTrips = async (billRow) => ({ ...toBillDto(billRow), trips: await listTrips(billRow) });
const listTrips = async (bill) => {
  const ids = (bill.sourceTripIds ?? []).map(String);
  if (!ids.length) return [];
  return tripDtos(sortTrips(await TruckTrip.find({ _id: { $in: ids } }).lean()));
};
export const listBillTrips = async (id) => listTrips(await load(id));

const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x));

/** Draft from Pheeras. Returns { bill, duplicate }. */
export const generateFromTrips = async ({ tripIds, requestId }, actor) => {
  const ids = tripIds.map(String);
  const replay = async () => {
    const [existing] = await Bill.find({ requestId }).lean();
    if (!existing) return null;
    if (!sameSet((existing.sourceTripIds ?? []).map(String), ids)) throw ApiError.conflict("This requestId was already used for a different set of Pheeras");
    return { bill: await withTrips(existing), duplicate: true };
  };
  const again = await replay();
  if (again) return again;

  const { trips, customer } = await loadEligible(ids);
  const billId = new mongoose.Types.ObjectId().toString();
  const tripIdsInOrder = trips.map((t) => String(t._id));
  try {
    const created = await runInTransaction(async (session) => {
      await assertCustomersActive([customer._id], session); // archived a moment ago: no new draft may reserve its Pheeras
      const reserved = await reserveTrips({ tripIds: tripIdsInOrder, customerId: customer._id, billId, actor, session });
      if (reserved !== trips.length) {
        if (!session && reserved) await releaseTrips({ tripIds: tripIdsInOrder, billId, actor, reason: "Draft could not be created", session });
        throw conflictList("Some Pheeras were taken by another bill while this draft was being made. Nothing was created. Reload and try again", [`${trips.length - reserved} of ${trips.length} Pheeras were no longer available`]);
      }
      try {
        return await createDraft({}, actor, { customer: customerSnapshot(customer), customerId: customer._id, items: trips.map(tripLine) }, { session, fields: { _id: billId, sourceTripIds: tripIdsInOrder, requestId } });
      } catch (err) {
        if (!session) await releaseTrips({ tripIds: tripIdsInOrder, billId, actor, reason: "Draft could not be created", session });
        throw err;
      }
    });
    return { bill: { ...created, trips: await listTrips({ sourceTripIds: tripIdsInOrder }) }, duplicate: false };
  } catch (err) {
    if (err instanceof ApiError && err.statusCode !== 409 && !isDuplicateKey(err)) throw err;
    if (err instanceof ApiError || isDuplicateKey(err)) {
      const raced = await replay(); // the same request finished a moment earlier
      if (raced) return raced;
    }
    throw err;
  }
};

const requireDraft = (bill) => {
  if (bill.status !== BILL_STATUS.DRAFT || bill.isDeleted) throw conflictDraftOnly(bill);
};

const saveItems = async ({ bill, items, sourceTripIds, actor, note }) => {
  const settings = await loadSettings();
  const calc = compute({ items, taxMode: bill.taxMode, customer: bill.customer }, settings.stateCode, settings);
  const revision = bill.revision + 1;
  return { calc, revision, write: (s) => Bill.updateOne({ _id: bill._id, status: BILL_STATUS.DRAFT, revision: bill.revision, isDeleted: false }, { $set: { ...calc, sourceTripIds, revision, updatedBy: actorOf(actor).id, updatedByName: actorOf(actor).name }, $push: { history: historyRow(BILL_HISTORY.UPDATE, actor, revision, { reason: note }) } }, s ? { session: s } : undefined) };
};

/** Adds Pheeras of the draft's own customer to a draft. */
export const addTrips = async (billId, { tripIds, revision }, actor) => {
  const bill = await load(billId);
  requireDraft(bill);
  if (revision !== undefined && revision !== bill.revision) throw conflictDraftOnly(bill);
  if (!bill.customerId) throw ApiError.conflict("This draft is not linked to a saved customer, so Pheeras cannot be added. Choose a saved customer for the draft first");
  const { trips } = await loadEligible(tripIds, { customerId: bill.customerId });
  const ids = trips.map((t) => String(t._id));
  const sourceTripIds = [...(bill.sourceTripIds ?? []).map(String), ...ids];
  const { write } = await saveItems({ bill, items: [...bill.items, ...trips.map(tripLine)], sourceTripIds, actor, note: `Added ${ids.length} Pheera` });
  await runInTransaction(async (session) => {
    await assertCustomersActive([bill.customerId], session);
    const reserved = await reserveTrips({ tripIds: ids, customerId: bill.customerId, billId, actor, session });
    if (reserved !== ids.length) {
      if (!session && reserved) await releaseTrips({ tripIds: ids, billId, actor, reason: "Add to draft failed", session });
      throw conflictList("Some Pheeras were taken by another bill. Nothing was added. Reload and try again", [`${ids.length - reserved} of ${ids.length} Pheeras were no longer available`]);
    }
    const result = await write(session);
    if (!result.matchedCount) {
      if (!session) await releaseTrips({ tripIds: ids, billId, actor, reason: "Add to draft failed", session });
      throw conflictDraftOnly(bill);
    }
  });
  return withTrips(await load(billId));
};

/** Removes one Pheera line from a draft and releases the Pheera (UNBILLED again). */
export const removeTrip = async (billId, tripId, actor) => {
  const bill = await load(billId);
  requireDraft(bill);
  const id = String(tripId);
  if (!bill.items.some((i) => i.sourceTripId && String(i.sourceTripId) === id)) throw ApiError.notFound("That Pheera is not on this draft");
  const items = bill.items.filter((i) => !(i.sourceTripId && String(i.sourceTripId) === id));
  const sourceTripIds = (bill.sourceTripIds ?? []).map(String).filter((x) => x !== id);
  const { write } = await saveItems({ bill, items, sourceTripIds, actor, note: "Removed 1 Pheera line" });
  await runInTransaction(async (session) => {
    const result = await write(session);
    if (!result.matchedCount) throw conflictDraftOnly(bill);
    const released = await releaseTrips({ tripIds: [id], billId, actor, reason: "Removed from the draft bill", session });
    if (released !== 1) throw ApiError.conflict("This Pheera is not reserved by this draft any more. Reload and try again");
  });
  return withTrips(await load(billId));
};
