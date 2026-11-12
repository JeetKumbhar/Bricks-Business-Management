import { BILL_STATUS } from "../constants/bill.js";
import { BILLING_ACTION, BILLING_STATUS, LOCKED_BILLING_STATUSES } from "../constants/billing.js";
import { CUSTOMER_KIND } from "../constants/customer.js";
import { MATERIAL_RULES, MATERIAL_CATEGORY } from "../constants/truck.js";
import Bill from "../models/Bill.js";
import Customer from "../models/Customer.js";
import Truck from "../models/Truck.js";
import TruckTrip from "../models/TruckTrip.js";
import ApiError from "../utils/ApiError.js";
import { isFutureBusinessDate, todayBusinessDate } from "../utils/dates.js";
import { runInTransaction } from "../utils/transaction.js";
import { normalizeText, quantityError, resolveTripMaterial, textKey, truckNumberKey } from "../utils/truckRules.js";
import { assertCustomersActive } from "./customer.service.js";
import { lockedError } from "./tripBilling.service.js";
import { summarizeTrips } from "./truckTripCalculations.js";

// Pheera (transport trips). Rules for this module:
//  - ONE record per trip. A batch of five rows creates five separate records; nothing is ever grouped.
//  - The server numbers them: per truck and business date, 1, 2, 3 ... in row order, independent for every truck, restarting each day.
//    Numbers are never reused (a voided Pheera keeps its number) and editing never changes one. A unique index
//    {truck, date, number} is the safety net; a save that loses a race with another save is retried with fresh numbers.
//  - A batch is validated as a whole and written in ONE transaction: all rows or none. Saving the same submissionId again returns
//    the records saved the first time instead of creating new ones.
//  - Material: Bricks (whole bricks), Soil (tonnes) or Other with its real name (tonnes). The unit always follows the material.
//    Older names (Sand, Cement, Stone ...) are ordinary Other records in tonnes and stay readable and editable.
//  - Corrections keep the old values (who, when, why). Delete is a soft delete ("void") with a reason. Voided records are left out
//    of every total. Totals are never stored.
//  - Pheera never read or write labour, attendance, payments or salary, and a truck's status never blocks a Pheera.

const MAX_ATTEMPTS = 3;
const fieldError = (status, message, field) => new ApiError(status, message, [{ field, message }]);
const isDuplicateKey = (err) => err?.code === 11000;
const live = { isDeleted: false };

// ---------- Output shapes (the frontend's own field names) ----------

const snapshotDto = (b) => ({ materialCategory: b.materialCategory, materialName: b.materialName, destination: b.destination, quantity: b.quantity, unit: b.unit, remarks: b.remarks ?? "" });

export const toTripDto = (row, bill = null) => ({
  id: String(row._id),
  truckId: String(row.truckId),
  truckNumber: row.truckNumber,
  businessDate: row.businessDate,
  pheeraNo: row.pheeraNo,
  materialCategory: row.materialCategory,
  materialName: row.materialName,
  quantityLabel: MATERIAL_RULES[row.materialCategory]?.quantityLabel ?? "Weight (Tonnes)",
  destination: row.destination,
  quantity: row.quantity,
  unit: row.unit,
  remarks: row.remarks ?? "",
  revision: row.revision ?? 1,
  corrected: (row.history ?? []).some((h) => h.action === "CORRECT"),
  isVoided: Boolean(row.isDeleted),
  voidReason: row.isDeleted ? row.deletedReason : null,
  voidedAt: row.isDeleted ? row.deletedAt : null,
  voidedBy: row.isDeleted ? row.deletedBy : null,
  customer: row.customerId ? { id: String(row.customerId), name: row.customerName ?? "" } : null,
  billingStatus: row.billingStatus ?? null, // null = a historical Pheera (not billable, not locked)
  billId: row.billId ? String(row.billId) : null,
  bill: bill ? { id: String(bill._id), billNumber: bill.billNumber ?? null, status: bill.status } : null,
  reservedAt: row.reservedAt ?? null,
  billedAt: row.billedAt ?? null,
  submissionId: row.submissionId ?? null,
  clientRowId: row.clientRowId ?? null,
  createdAt: row.createdAt,
  createdBy: row.createdByName ?? null,
  updatedAt: row.updatedAt,
  updatedBy: row.updatedByName ?? null,
});

const toDetailDto = (row, bill = null) => ({
  ...toTripDto(row, bill),
  billingHistory: (row.billingHistory ?? []).map((h) => ({ action: h.action, at: h.at, by: h.by, billId: h.billId ? String(h.billId) : null, billNumber: h.billNumber ?? null, previousBillId: h.previousBillId ? String(h.previousBillId) : null, previousBillNumber: h.previousBillNumber ?? null, reason: h.reason ?? null })),
  audit: (row.history ?? []).map(({ action, revision, at, by, reason, before }) => ({ action, revision, at, by, reason, before: snapshotDto(before) })),
});

/** The bill (number and status) each Pheera is currently held by, looked up once for a page of records. */
const billsOf = async (rows) => {
  const billIds = [...new Set(rows.filter((r) => r.billId).map((r) => String(r.billId)))];
  if (!billIds.length) return new Map();
  const found = await Bill.find({ _id: { $in: billIds } }).lean();
  return new Map(found.map((b) => [String(b._id), b]));
};
export const tripDtos = async (rows) => {
  const bills = await billsOf(rows);
  return rows.map((r) => toTripDto(r, r.billId ? bills.get(String(r.billId)) : null));
};

export const summaryDto = (rows) => summarizeTrips(rows);

// ---------- Filters (shared with the reports) ----------

/** "mh04" matches "MH-04-AB-1234": letters and digits in order with anything between them. Only A-Z0-9 reach the pattern, so it is safe. */
const registrationPattern = (text) => new RegExp([...truckNumberKey(text)].join("[^A-Z0-9]*"), "i");

export const buildTripFilter = ({ truckId, registration, material, materialName, destination, date, from, to, includeVoided = false, customerId, billingStatus, billId, billable } = {}) => ({
  ...(includeVoided ? {} : live),
  ...(truckId ? { truckId } : {}),
  ...(customerId ? { customerId } : {}),
  ...(billId ? { billId } : {}),
  // billable=true: only normal customers' Pheeras still waiting for an invoice. NOT_BILLABLE (internal) can never match.
  ...(billable ? { billingStatus: BILLING_STATUS.UNBILLED } : billingStatus ? { billingStatus } : {}),
  ...(registration ? { truckNumber: truckNumberKey(registration) ? registrationPattern(registration) : { $in: [] } } : {}), // text with no letters or digits matches nothing
  ...(material ? { materialCategory: material } : {}),
  ...(materialName ? { materialKey: textKey(materialName) } : {}),
  ...(destination ? { destinationKey: textKey(destination) } : {}),
  ...(date ? { businessDate: date } : from || to ? { businessDate: { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) } } : {}),
});

// ---------- Reads ----------

/** Individual Pheera records, newest first, paged. `summary` covers every live record that matches, not only the page. */
export const listTrips = async (query) => {
  const { page = 1, limit = 100 } = query;
  const filter = buildTripFilter(query);
  const [total, rows, all] = await Promise.all([
    TruckTrip.countDocuments(filter),
    TruckTrip.find(filter).sort({ businessDate: -1, truckNumber: 1, pheeraNo: 1 }).skip((page - 1) * limit).limit(limit).lean(),
    TruckTrip.find({ ...filter, ...live }).lean(),
  ]);
  return { items: await tripDtos(rows), page, limit, total, summary: summaryDto(all) };
};

/** The saved Pheera of one day (optionally one truck), in truck then Pheera order, with the day's totals. */
export const getDay = async ({ date, truckId, includeVoided = false }) => {
  const rows = (await TruckTrip.find(buildTripFilter({ date, truckId, includeVoided })).lean()).sort((a, b) => a.truckNumber.localeCompare(b.truckNumber) || a.pheeraNo - b.pheeraNo);
  return { date, items: await tripDtos(rows), summary: summaryDto(rows.filter((r) => !r.isDeleted)) };
};

const loadTrip = async (id) => {
  const [row] = await TruckTrip.find({ _id: id }).lean();
  if (!row) throw ApiError.notFound("Pheera record not found");
  return row;
};

/** One record with its correction trail. */
export const getTrip = async (id) => {
  const row = await loadTrip(id);
  const [bill] = row.billId ? await Bill.find({ _id: String(row.billId) }).lean() : [];
  return toDetailDto(row, bill ?? null);
};

/** Values for the filter drop-downs: the standard materials plus every material and destination actually used. */
export const getOptions = async () => {
  const rows = await TruckTrip.find({ ...live }).lean();
  const materials = new Map([[textKey("Bricks"), { name: "Bricks", key: "bricks", category: MATERIAL_CATEGORY.BRICKS, unit: "bricks" }], [textKey("Soil"), { name: "Soil", key: "soil", category: MATERIAL_CATEGORY.SOIL, unit: "tonnes" }]]);
  const destinations = new Map();
  for (const r of rows) {
    if (!materials.has(r.materialKey)) materials.set(r.materialKey, { name: r.materialName, key: r.materialKey, category: r.materialCategory, unit: r.unit });
    if (!destinations.has(r.destinationKey)) destinations.set(r.destinationKey, { name: r.destination, key: r.destinationKey });
  }
  const sorted = (map) => [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  return { materials: sorted(materials), destinations: sorted(destinations) };
};

// ---------- Write: create (one or many) ----------

const rowErrorsOf = (resolved) => resolved.flatMap((r, i) => Object.entries(r.errors ?? {}).map(([field, message]) => ({ field: `trips.${i}.${field}`, message })));

/**
 * Saves each row as its OWN Pheera record, all together or none. rows: [{ material, customMaterialName?, destination, quantity,
 * unit?, remarks?, clientRowId? }]. Returns { records, duplicate }: duplicate is true when the same submissionId had already been saved.
 */
export const createTrips = async ({ truckId, businessDate, submissionId = null, rows }, actor, now = new Date()) => {
  if (isFutureBusinessDate(businessDate, now)) throw fieldError(400, `The date cannot be in the future (today is ${todayBusinessDate(now)})`, "businessDate");
  const [truck] = await Truck.find({ _id: truckId }).lean();
  if (!truck) throw fieldError(400, "Truck not found", "truckId");

  const resolved = rows.map((row) => resolveTripMaterial({ material: row.material, customMaterialName: row.customMaterialName ?? "", quantity: row.quantity, unit: row.unit }));
  const errors = rowErrorsOf(resolved);
  if (errors.length) throw ApiError.badRequest("Some rows cannot be saved. Nothing was saved.", errors);

  // Every NEW Pheera needs a real, active customer. The built-in Internal customer makes it NOT_BILLABLE; everyone else UNBILLED.
  const customerIds = [...new Set(rows.map((r) => String(r.customerId)))];
  const found = await Customer.find({ _id: { $in: customerIds } }).lean();
  const customers = new Map(found.map((c) => [String(c._id), c]));
  const customerErrors = rows.flatMap((r, i) => {
    const c = customers.get(String(r.customerId));
    if (!c) return [{ field: `trips.${i}.customerId`, message: "Customer not found" }];
    if (c.isDeleted) return [{ field: `trips.${i}.customerId`, message: `Customer "${c.name}" is archived` }];
    return [];
  });
  if (customerErrors.length) {
    // An unknown customer is a bad request (400). A customer that exists but is archived is a conflict (409), the same answer
    // assertCustomersActive gives when the customer is archived during the save.
    const unknown = customerErrors.some((e) => e.message === "Customer not found");
    throw unknown ? ApiError.badRequest("Some rows cannot be saved. Nothing was saved.", customerErrors) : ApiError.conflict("Some rows cannot be saved. Nothing was saved.", customerErrors);
  }

  const actorId = actor.id ?? null;
  const build = (max) =>
    rows.map((row, i) => ({
      truckId,
      truckNumber: truck.truckNumber, // snapshot: reports keep the number even if the truck is corrected later
      businessDate,
      pheeraNo: max + 1 + i,
      ...resolved[i].value,
      customerId: String(row.customerId),
      customerName: customers.get(String(row.customerId)).name,
      billingStatus: customers.get(String(row.customerId)).kind === CUSTOMER_KIND.INTERNAL ? BILLING_STATUS.NOT_BILLABLE : BILLING_STATUS.UNBILLED,
      billId: null,
      reservedAt: null,
      billedAt: null,
      billingHistory: [],
      destination: normalizeText(row.destination),
      destinationKey: textKey(row.destination),
      remarks: normalizeText(row.remarks),
      submissionId,
      clientRowId: submissionId ? (row.clientRowId ?? `row-${i}`) : (row.clientRowId ?? null),
      revision: 1,
      history: [],
      isDeleted: false,
      deletedAt: null,
      deletedBy: null,
      deletedReason: null,
      createdBy: actorId,
      createdByName: actor.name ?? null,
      updatedBy: actorId,
      updatedByName: actor.name ?? null,
    }));

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const result = await runInTransaction(async (session) => {
        if (submissionId) {
          const previous = await TruckTrip.find({ submissionId }).session(session).lean();
          if (previous.length) {
            if (String(previous[0].truckId) !== String(truckId) || previous[0].businessDate !== businessDate) {
              throw fieldError(409, "This submissionId was already used for a different truck or date", "submissionId");
            }
            return { records: previous.sort((a, b) => a.pheeraNo - b.pheeraNo), duplicate: true };
          }
        }
        await assertCustomersActive(rows.map((r) => r.customerId), session); // a customer archived a moment ago gets no new Pheera
        // Voided Pheera count too, so a number is never reused.
        const existing = await TruckTrip.find({ truckId, businessDate }).session(session).lean();
        const max = existing.reduce((m, t) => Math.max(m, t.pheeraNo), 0);
        const created = await TruckTrip.insertMany(build(max), { session });
        return { records: created.map((d) => d.toObject({ transform: false })), duplicate: false };
      });
      return { records: result.records.map((r) => toTripDto(r)), duplicate: result.duplicate };
    } catch (err) {
      if (!isDuplicateKey(err)) throw err;
      // Another save took one of these numbers (or this submission) at the same moment: read again and number afresh.
      if (attempt === MAX_ATTEMPTS) throw ApiError.conflict("Another save for this truck and date happened at the same moment. Reload and try again.");
    }
  }
  throw ApiError.conflict("Could not save. Reload and try again."); // unreachable; keeps the function total
};

// ---------- Write: correct or void ----------

/**
 * Correct material / destination / quantity / remarks. The truck, date and Pheera number never change. If the material changes,
 * the quantity must be sent again and is checked against the NEW unit (a number is never reinterpreted in another unit).
 */
export const correctTrip = async (id, input, actor, now = new Date()) => {
  const trip = await loadTrip(id);
  if (trip.isDeleted) throw ApiError.conflict("A voided Pheera cannot be corrected");
  if (LOCKED_BILLING_STATUSES.includes(trip.billingStatus)) throw await lockedError(trip, "corrected");

  let material = { materialCategory: trip.materialCategory, materialName: trip.materialName, materialKey: trip.materialKey, unit: trip.unit };
  let materialChanged = false;
  if (input.material !== undefined) {
    const result = resolveTripMaterial({ material: input.material, customMaterialName: input.customMaterialName ?? "", quantity: input.quantity ?? 1, unit: input.unit });
    if (result.errors) throw ApiError.badRequest("Validation failed", Object.entries(result.errors).map(([field, message]) => ({ field, message })));
    const { quantity: _ignored, ...resolvedMaterial } = result.value;
    material = resolvedMaterial;
    materialChanged = material.materialCategory !== trip.materialCategory || material.materialKey !== trip.materialKey;
    if (materialChanged && input.quantity === undefined) throw fieldError(400, "Re-enter the quantity for the new material", "quantity");
  }
  if (input.unit !== undefined && input.unit !== material.unit) throw fieldError(400, `This material is counted in ${material.unit}`, "unit");

  const quantity = input.quantity ?? trip.quantity;
  if (input.quantity !== undefined || materialChanged) {
    const problem = quantityError(quantity, material.unit);
    if (problem) throw fieldError(400, problem, "quantity");
  }
  const destination = input.destination === undefined ? trip.destination : normalizeText(input.destination);
  const remarks = input.remarks === undefined ? trip.remarks ?? "" : normalizeText(input.remarks);

  const next = { ...material, quantity, destination, destinationKey: textKey(destination), remarks };
  const unchanged = ["materialCategory", "materialName", "quantity", "unit", "destination", "remarks"].every((k) => next[k] === (trip[k] ?? ""));
  if (unchanged) return toDetailDto(trip);

  const actorId = actor.id ?? null;
  const result = await TruckTrip.updateOne(
    { _id: trip._id, revision: trip.revision, ...live, billingStatus: { $nin: LOCKED_BILLING_STATUSES } }, // also checked in the write: a Pheera reserved a moment ago does not match
    {
      $set: { ...next, updatedBy: actorId, updatedByName: actor.name ?? null },
      $inc: { revision: 1 },
      $push: { history: { action: "CORRECT", revision: trip.revision, at: now, by: actor.name, byId: actorId, reason: input.reason, before: snapshotDto(trip) } },
    }
  );
  if (result.matchedCount !== 1) throw ApiError.conflict("This Pheera was changed by someone else. Reload and try again.");
  return getTrip(id);
};

/** Void (soft delete): the record stays with who, when and why, keeps its number, and is left out of every total. */
export const voidTrip = async (id, { reason }, actor, now = new Date()) => {
  const trip = await loadTrip(id);
  if (trip.isDeleted) throw ApiError.conflict("This Pheera is already voided");
  if (LOCKED_BILLING_STATUSES.includes(trip.billingStatus)) throw await lockedError(trip, "voided");
  const actorId = actor.id ?? null;
  const result = await TruckTrip.updateOne(
    { _id: trip._id, revision: trip.revision, ...live, billingStatus: { $nin: LOCKED_BILLING_STATUSES } },
    {
      $set: { isDeleted: true, deletedAt: now, deletedBy: actor.name, deletedReason: reason, updatedBy: actorId, updatedByName: actor.name ?? null },
      $inc: { revision: 1 },
      $push: { history: { action: "VOID", revision: trip.revision, at: now, by: actor.name, byId: actorId, reason, before: snapshotDto(trip) } },
    }
  );
  if (result.matchedCount !== 1) throw ApiError.conflict("This Pheera was changed by someone else. Reload and try again.");
  return getTrip(id);
};

// ---------- Billing workflow: assign a customer, release ----------

const historyEntry = (action, actor, extra = {}) => ({ action, at: new Date(), by: actor.name ?? "Unknown", byId: actor.id ?? null, billId: null, billNumber: null, reason: null, ...extra });

/**
 * Attach a customer to a Pheera: a historical Pheera (no customer yet), or fix a wrong customer while it is still UNBILLED or
 * NOT_BILLABLE. Never automatic. A reserved or billed Pheera is locked. The status follows the customer (Internal -> NOT_BILLABLE).
 */
export const assignCustomer = async (id, { customerId, reason }, actor) => {
  const trip = await loadTrip(id);
  if (trip.isDeleted) throw ApiError.conflict("A voided Pheera cannot be changed");
  if (LOCKED_BILLING_STATUSES.includes(trip.billingStatus)) throw await lockedError(trip, "reassigned to another customer");
  const [customer] = await Customer.find({ _id: customerId }).lean();
  if (!customer) throw fieldError(400, "Customer not found", "customerId");
  if (customer.isDeleted) throw fieldError(409, `Customer "${customer.name}" is archived`, "customerId");
  if (trip.customerId && String(trip.customerId) === String(customerId)) throw ApiError.conflict("This Pheera already has that customer");
  const status = customer.kind === CUSTOMER_KIND.INTERNAL ? BILLING_STATUS.NOT_BILLABLE : BILLING_STATUS.UNBILLED;
  const known = [BILLING_STATUS.UNBILLED, BILLING_STATUS.NOT_BILLABLE];
  const result = await runInTransaction(async (session) => {
    await assertCustomersActive([customer._id], session);
    return TruckTrip.updateOne(
      { _id: trip._id, revision: trip.revision, ...live, billingStatus: trip.billingStatus ? trip.billingStatus : { $nin: [...known, ...LOCKED_BILLING_STATUSES] } },
      {
        $set: { customerId: String(customer._id), customerName: customer.name, billingStatus: status, updatedBy: actor.id ?? null, updatedByName: actor.name ?? null },
        $inc: { revision: 1 },
        $push: { billingHistory: historyEntry(BILLING_ACTION.CUSTOMER_ASSIGNED, actor, { customerId: String(customer._id), reason }) },
      },
      session ? { session } : undefined
    );
  });
  if (result.matchedCount !== 1) throw ApiError.conflict("This Pheera was changed by someone else. Reload and try again.");
  return getTrip(id);
};

/**
 * Explicit release (owner, reason required): a BILLED Pheera whose invoice is CANCELLED goes back to UNBILLED so it can be billed
 * again. The cancelled invoice stays in the Pheera's billing history. A Pheera on a live invoice, or in a draft, cannot be released here.
 */
export const releaseTrip = async (id, { reason }, actor) => {
  const trip = await loadTrip(id);
  if (trip.billingStatus === BILLING_STATUS.RESERVED) throw ApiError.conflict("This Pheera is in a draft bill. Remove it from the draft instead");
  if (trip.billingStatus !== BILLING_STATUS.BILLED) throw ApiError.conflict("Only a billed Pheera whose invoice was cancelled can be released");
  const [bill] = await Bill.find({ _id: String(trip.billId) }).lean();
  if (!bill || bill.status !== BILL_STATUS.CANCELLED) throw ApiError.conflict(`This Pheera is on invoice ${bill?.billNumber ?? ""}, which is not cancelled. Cancel the invoice first`.replace("  ", " "));
  const result = await TruckTrip.updateOne(
    { _id: trip._id, billId: String(trip.billId), billingStatus: BILLING_STATUS.BILLED, ...live },
    {
      $set: { billingStatus: BILLING_STATUS.UNBILLED, billId: null, reservedAt: null, billedAt: null, updatedBy: actor.id ?? null, updatedByName: actor.name ?? null },
      $push: { billingHistory: historyEntry(BILLING_ACTION.RELEASED, actor, { billId: String(bill._id), billNumber: bill.billNumber ?? null, reason }) },
    }
  );
  if (result.matchedCount !== 1) throw ApiError.conflict("This Pheera was changed by someone else. Reload and try again.");
  return getTrip(id);
};
