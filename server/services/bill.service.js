import mongoose from "mongoose";
import { BILL_HISTORY, BILL_STATUS, MAX_BILL_TOTAL_PAISE, SETTINGS_ID, TAX_MODE } from "../constants/bill.js";
import { BILLING_STATUS } from "../constants/billing.js";
import { CUSTOMER_KIND, INTERNAL_CUSTOMER_NAME } from "../constants/customer.js";
import Bill from "../models/Bill.js";
import Counter from "../models/Counter.js";
import ApiError from "../utils/ApiError.js";
import { amountInWords } from "../utils/amountInWords.js";
import { bpToPercent, counterIdFor, financialYearOf, formatBillNumber, milliToNumber, parseBp, parseMilli, parseRupeesToPaise } from "../utils/billRules.js";
import { isFutureBusinessDate, toBusinessDate, todayBusinessDate } from "../utils/dates.js";
import { runInTransaction } from "../utils/transaction.js";
import { escapeRegExp, textKey } from "../utils/truckRules.js";
import TruckTrip from "../models/TruckTrip.js";
import { calculateBill, deriveTaxType } from "./billCalculations.js";
import { assertCustomersActive, customerSnapshot, INTERNAL_KEY, loadCustomer } from "./customer.service.js";
import { loadSettings } from "./invoiceSettings.service.js";
import { markBilled, moveTrips, noteBillCancelled, releaseTrips, undoMove } from "./tripBilling.service.js";

// Bills. Policy (documented in the Phase 11 report):
//  - A DRAFT has no bill number, so abandoned drafts never use one up. The number is allocated only when the owner FINALIZES.
//  - Numbers come from an atomic counter per prefix + financial year, inside the same transaction as the finalize, so two bills
//    finalized at the same moment get different numbers and a failed finalize does not burn a number.
//  - FINALIZED is frozen: no edit. A mistake is fixed by CANCEL (reason required; number kept, never reused) and a new bill.
//  - Every figure is recalculated here from quantity, rate and tax rate. Totals sent by a client are rejected by the validators.
const SELLER_FIELDS = ["businessName", "businessDescription", "productsLine", "gstin", "pan", "address", "phones", "jurisdiction", "stateName", "stateCode", "bank", "proprietorName"];
const gstOf = (b) => b.cgstPaise + b.sgstPaise + b.igstPaise;
export const actorOf = (actor) => ({ id: actor.id ?? null, name: actor.name ?? "Unknown" });
export const historyRow = (action, actor, revision, extra = {}) => ({ action, at: new Date(), by: actorOf(actor).name, byId: actorOf(actor).id, fromStatus: null, toStatus: null, reason: null, revision, ...extra });

export const conflictDraftOnly = (bill) => ApiError.conflict(bill.status === BILL_STATUS.DRAFT ? "This draft was changed by someone else. Reload and try again" : `Bill ${bill.billNumber} is ${bill.status.toLowerCase()} and can no longer be edited. Cancel it and issue a new bill instead`);

// ---- request body -> stored fields ---------------------------------------------------------------------------------------------
const toItem = (item) => ({
  particulars: item.particulars ?? "",
  hsn: item.hsn ?? "",
  quantityMilli: item.quantity === undefined ? 0 : parseMilli(item.quantity),
  unit: item.unit ?? "",
  ratePaise: item.rate === undefined ? 0 : parseRupeesToPaise(item.rate),
  taxRateBp: item.taxRate === undefined || item.taxRate === null ? null : parseBp(item.taxRate),
});

/** Re-derives tax type and every amount. `sellerStateCode` is the seller's state (settings for a draft, the snapshot once finalized). */
export const compute = ({ items, taxMode, customer }, sellerStateCode, settings) => {
  const errors = [];
  if (taxMode === TAX_MODE.NON_GST) items.forEach((it, i) => it.taxRateBp && errors.push({ field: `items.${i}.taxRate`, message: "A non-GST bill cannot have a tax rate. Remove it or switch the bill to GST" }));
  if (taxMode === TAX_MODE.GST && settings?.allowedTaxRatesBp?.length) items.forEach((it, i) => it.taxRateBp !== null && !settings.allowedTaxRatesBp.includes(it.taxRateBp) && errors.push({ field: `items.${i}.taxRate`, message: `Tax rate ${bpToPercent(it.taxRateBp)}% is not in your allowed list (Settings)` }));
  if (errors.length) throw ApiError.badRequest("Validation failed", errors);
  const taxType = taxMode === TAX_MODE.GST ? deriveTaxType(sellerStateCode, customer.stateCode) : null;
  const { lines, totals, taxPending } = calculateBill({ items, taxMode, taxType });
  if (totals.grandTotalPaise > MAX_BILL_TOTAL_PAISE) throw ApiError.badRequest("Validation failed", [{ field: "items", message: "The bill total is too large" }]);
  return { items: items.map((it, i) => ({ ...it, ...lines[i] })), taxType, taxPending, ...totals };
};

const customerOf = (input = {}, base = {}) => {
  const c = { name: "", address: "", gstin: "", stateName: "", stateCode: "", contact: "", ...base, ...input };
  return c;
};

// ---- output --------------------------------------------------------------------------------------------------------------------
const itemDto = (i) => ({ pricingUnit: i.pricingUnit ?? "PER_UNIT", sourceTripId: i.sourceTripId ? String(i.sourceTripId) : null, source: i.source ?? null, particulars: i.particulars, hsn: i.hsn, quantity: milliToNumber(i.quantityMilli), quantityMilli: i.quantityMilli, unit: i.unit, ratePaise: i.ratePaise, taxRate: bpToPercent(i.taxRateBp), taxRateBp: i.taxRateBp, taxablePaise: i.taxablePaise, cgstPaise: i.cgstPaise, sgstPaise: i.sgstPaise, igstPaise: i.igstPaise, totalPaise: i.totalPaise });

export const toListDto = (b) => ({
  id: String(b._id), billNumber: b.billNumber ?? null, status: b.status, billDate: b.billDate, customerName: b.customer?.name ?? "", customerGstin: b.customer?.gstin ?? "",
  taxMode: b.taxMode, taxableTotalPaise: b.taxableTotalPaise, gstPaise: gstOf(b), grandTotalPaise: b.grandTotalPaise, itemCount: b.items?.length ?? 0, customerId: b.customerId ? String(b.customerId) : null, tripCount: b.sourceTripIds?.length ?? 0, finalizedAt: b.finalizedAt ?? null, cancelledAt: b.cancelledAt ?? null, createdAt: b.createdAt,
});

export const toBillDto = (b) => ({
  ...toListDto(b),
  customer: b.customer, sourceTripIds: (b.sourceTripIds ?? []).map(String), taxType: b.taxType ?? null, taxPending: Boolean(b.taxPending), items: (b.items ?? []).map(itemDto), cgstPaise: b.cgstPaise, sgstPaise: b.sgstPaise, igstPaise: b.igstPaise,
  amountInWords: b.amountInWords || amountInWords(b.grandTotalPaise), notes: b.notes ?? "", seller: b.seller ?? null, numberSeries: b.numberSeries ?? null, financialYear: b.financialYear ?? null,
  replacesBillNumber: b.replacesBillNumber ?? null, revision: b.revision, finalizedBy: b.finalizedBy ?? null,
  finalizedOn: b.finalizedAt ? toBusinessDate(b.finalizedAt) : null, cancelledOn: b.cancelledAt ? toBusinessDate(b.cancelledAt) : null, cancelledBy: b.cancelledBy ?? null, cancelledReason: b.cancelledReason ?? null,
  createdBy: b.createdByName ?? null, updatedBy: b.updatedByName ?? null, updatedAt: b.updatedAt, history: b.history ?? [],
});

export const load = async (id, session = null) => {
  const query = Bill.find({ _id: id }).lean();
  const [bill] = await (session ? query.session(session) : query);
  if (!bill) throw ApiError.notFound("Bill not found");
  return bill;
};

/** The saved customer a bill may be linked to: it must exist, be active and be a NORMAL customer (never the Internal / No Bill one). */
const resolveBillCustomer = async (customerId) => {
  const customer = await loadCustomer(customerId);
  if (customer.kind === CUSTOMER_KIND.INTERNAL) throw ApiError.conflict(`"${INTERNAL_CUSTOMER_NAME}" is for own-use trips and cannot be used as an invoice customer`);
  if (customer.isDeleted) throw ApiError.conflict(`Customer "${customer.name}" is archived. Restore it first`);
  return customer;
};
/** A bill linked to a saved customer keeps that customer's EXACT display name; any other spelling, case or spacing is refused. */
const lockedName = (supplied, savedName) => {
  if (supplied !== undefined && supplied !== savedName) {
    const message = `The name of a saved customer cannot be changed on a bill. This bill's customer is "${savedName}"`;
    throw ApiError.conflict(message, [{ field: "customer.name", message }]);
  }
  return savedName;
};
const refuseInternalName = (name) => {
  if (name && textKey(name) === INTERNAL_KEY) throw ApiError.badRequest("Validation failed", [{ field: "customer.name", message: `"${INTERNAL_CUSTOMER_NAME}" cannot be used as an invoice customer` }]);
};

// ---- drafts --------------------------------------------------------------------------------------------------------------------
/**
 * `base` copies an existing bill (correction). `extra` = { session, fields } is used by the Pheera workflows: fields (_id, sourceTripIds,
 * requestId ...) are set by the server only, never by a client request.
 */
export const createDraft = async (body, actor, base = {}, { session = null, fields = {} } = {}) => {
  const settings = await loadSettings();
  const taxMode = body.taxMode ?? base.taxMode ?? settings.defaultTaxMode;
  const linked = body.customerId ? await resolveBillCustomer(body.customerId) : null;
  if (body.items?.some((i) => i.sourceTripId)) throw ApiError.badRequest("Validation failed", [{ field: "items", message: "Pheera lines are created with Generate from Pheeras, not typed in" }]);
  const customer = linked ? { ...customerOf(body.customer, customerSnapshot(linked)), name: lockedName(body.customer?.name, linked.name) } : customerOf(body.customer, base.customer);
  refuseInternalName(customer.name);
  const items = (body.items ?? base.items ?? []).map((i) => (i.quantityMilli === undefined ? toItem(i) : i));
  const calc = compute({ items, taxMode, customer }, settings.stateCode, settings);
  const billDate = body.billDate ?? todayBusinessDate();
  const [created] = await Bill.insertMany([
    {
      status: BILL_STATUS.DRAFT, billDate, customer, customerKey: customer.name.toLowerCase(), taxMode, notes: body.notes ?? base.notes ?? "", ...calc, amountInWords: "", revision: 1,
      replacesBillNumber: base.replacesBillNumber ?? null, history: [historyRow(BILL_HISTORY.CREATE, actor, 1, { toStatus: BILL_STATUS.DRAFT })],
      customerId: linked ? String(linked._id) : base.customerId ? String(base.customerId) : null,
      isDeleted: false, createdBy: actorOf(actor).id, createdByName: actorOf(actor).name, updatedBy: actorOf(actor).id, updatedByName: actorOf(actor).name, ...fields,
    },
  ], session ? { session } : undefined);
  return toBillDto(created.toObject ? created.toObject({ transform: false }) : created);
};

/** Pheera lines of a draft: the owner may change particulars, HSN, rate and tax rate, but quantity and unit come from the Pheera. A line left out is removed (its Pheera is released). */
const mergeTripLines = (bill, bodyItems) => {
  const existing = new Map(bill.items.filter((i) => i.sourceTripId).map((i) => [String(i.sourceTripId), i]));
  const kept = new Set();
  const errors = [];
  const items = bodyItems.map((raw, index) => {
    if (!raw.sourceTripId) return toItem(raw);
    const old = existing.get(raw.sourceTripId);
    if (!old) return errors.push({ field: `items.${index}.sourceTripId`, message: "This is not a Pheera line of this draft. Use Add Pheeras" }), null;
    if (kept.has(raw.sourceTripId)) return errors.push({ field: `items.${index}.sourceTripId`, message: "This Pheera appears twice" }), null;
    kept.add(raw.sourceTripId);
    if (raw.quantity !== undefined && parseMilli(raw.quantity) !== old.quantityMilli) errors.push({ field: `items.${index}.quantity`, message: "The quantity of a Pheera line comes from the Pheera and cannot be changed here" });
    if (raw.unit !== undefined && raw.unit !== old.unit) errors.push({ field: `items.${index}.unit`, message: "The unit of a Pheera line comes from the Pheera and cannot be changed here" });
    const edited = toItem(raw);
    return { ...old, particulars: raw.particulars === undefined ? old.particulars : edited.particulars, hsn: raw.hsn === undefined ? old.hsn : edited.hsn, ratePaise: raw.rate === undefined ? old.ratePaise : edited.ratePaise, taxRateBp: raw.taxRate === undefined ? old.taxRateBp : edited.taxRateBp };
  });
  if (errors.length) throw ApiError.badRequest("Validation failed", errors);
  return { items, removed: [...existing.keys()].filter((k) => !kept.has(k)) };
};

export const updateDraft = async (id, body, actor) => {
  const bill = await load(id);
  if (bill.status !== BILL_STATUS.DRAFT || bill.isDeleted) throw conflictDraftOnly(bill);
  if (body.revision !== undefined && body.revision !== bill.revision) throw conflictDraftOnly(bill);
  const settings = await loadSettings();
  const taxMode = body.taxMode ?? bill.taxMode;
  const hasTrips = (bill.sourceTripIds?.length ?? 0) > 0;

  let customerId = bill.customerId ? String(bill.customerId) : null;
  let customerBase = bill.customer;
  let savedName = customerId ? bill.customer.name : null; // exact display name kept while the bill is linked to a saved customer
  if (body.customerId !== undefined && body.customerId !== customerId) {
    if (hasTrips) throw ApiError.conflict("This draft contains Pheera lines, so its customer cannot be changed. Remove the Pheera lines first");
    const linked = await resolveBillCustomer(body.customerId);
    customerId = String(linked._id);
    customerBase = customerSnapshot(linked);
    savedName = linked.name;
  }
  const customer = customerOf(body.customer, customerBase);
  if (savedName !== null) customer.name = lockedName(body.customer?.name, savedName);
  else refuseInternalName(customer.name);

  let items;
  let removed = [];
  if (!body.items) items = bill.items;
  else if (hasTrips) ({ items, removed } = mergeTripLines(bill, body.items));
  else if (body.items.some((i) => i.sourceTripId)) throw ApiError.badRequest("Validation failed", [{ field: "items", message: "This draft has no Pheera lines. Use Add Pheeras" }]);
  else items = body.items.map(toItem);

  const calc = compute({ items, taxMode, customer }, settings.stateCode, settings);
  const revision = bill.revision + 1;
  const sourceTripIds = calc.items.filter((i) => i.sourceTripId).map((i) => String(i.sourceTripId));
  const run = async (session) => {
    const result = await Bill.updateOne(
      { _id: id, status: BILL_STATUS.DRAFT, revision: bill.revision, isDeleted: false },
      { $set: { billDate: body.billDate ?? bill.billDate, customer, customerId, customerKey: customer.name.toLowerCase(), taxMode, notes: body.notes ?? bill.notes, ...calc, ...(hasTrips ? { sourceTripIds } : {}), revision, updatedBy: actorOf(actor).id, updatedByName: actorOf(actor).name }, $push: { history: historyRow(BILL_HISTORY.UPDATE, actor, revision, removed.length ? { reason: `Removed ${removed.length} Pheera line(s)` } : {}) } },
      session ? { session } : undefined
    );
    if (!result.matchedCount) throw conflictDraftOnly(bill);
    if (removed.length) {
      const released = await releaseTrips({ tripIds: removed, billId: id, actor, reason: "Line removed from the draft bill", session });
      if (released !== removed.length) throw ApiError.conflict("A Pheera of this draft changed while saving. Reload and try again");
    }
  };
  await (removed.length ? runInTransaction(run) : run(null));
  return toBillDto(await load(id));
};

export const discardDraft = async (id, body, actor) => {
  const bill = await load(id);
  if (bill.status !== BILL_STATUS.DRAFT) throw ApiError.conflict(`Only drafts can be discarded. Bill ${bill.billNumber} must be cancelled instead`);
  if (bill.isDeleted) return toBillDto(bill);
  const revision = bill.revision + 1;
  const tripIds = (bill.sourceTripIds ?? []).map(String);
  const run = async (session) => {
    const result = await Bill.updateOne({ _id: id, status: BILL_STATUS.DRAFT, isDeleted: false }, { $set: { isDeleted: true, deletedAt: new Date(), deletedBy: actorOf(actor).name, deletedReason: body.reason ?? null, revision }, $push: { history: historyRow(BILL_HISTORY.DISCARD, actor, revision, { fromStatus: BILL_STATUS.DRAFT, reason: body.reason ?? null }) } }, session ? { session } : undefined);
    if (!result.matchedCount) throw conflictDraftOnly(bill);
    if (tripIds.length) await releaseTrips({ tripIds, billId: id, actor, reason: body.reason ?? "Draft bill discarded", session }); // its Pheeras become UNBILLED again
  };
  await (tripIds.length ? runInTransaction(run) : run(null));
  return toBillDto(await load(id));
};

// ---- finalize ------------------------------------------------------------------------------------------------------------------
const sellerSnapshot = (settings) => Object.fromEntries(SELLER_FIELDS.map((k) => [k, structuredClone(settings[k])]));

/** What must be true before an invoice can be issued. */
const readinessErrors = (bill, seller) => {
  const e = [];
  const need = (ok, field, message) => ok || e.push({ field, message });
  const gst = bill.taxMode === TAX_MODE.GST;
  need(!isFutureBusinessDate(bill.billDate), "billDate", "A finalized bill cannot be dated in the future");
  need(seller.businessName && seller.address, "seller", "Fill the seller's business name and address in Settings first");
  if (gst) {
    need(seller.gstin, "seller.gstin", "Add the seller's GSTIN in Settings (or switch this bill to non-GST)");
    need(seller.stateCode, "seller.stateCode", "Add the seller's state code in Settings");
    need(bill.customer.stateCode, "customer.stateCode", "The customer's state code decides CGST+SGST or IGST");
  }
  need(bill.customer.name, "customer.name", "Customer name is required");
  need(bill.customer.address, "customer.address", "Customer address is required");
  need(bill.items.length > 0, "items", "Add at least one item");
  bill.items.forEach((it, i) => {
    need(it.particulars, `items.${i}.particulars`, "Particulars are required");
    need(it.unit, `items.${i}.unit`, "Unit is required");
    need(it.quantityMilli > 0, `items.${i}.quantity`, "Quantity must be greater than 0");
    need(it.ratePaise > 0, `items.${i}.rate`, "Rate must be greater than 0");
    if (gst) {
      need(it.hsn, `items.${i}.hsn`, "HSN/SAC code is required on a GST bill");
      need(it.taxRateBp !== null && it.taxRateBp !== undefined, `items.${i}.taxRate`, "Tax rate is required on every item of a GST bill (use 0 if nil-rated)");
    }
  });
  need(bill.grandTotalPaise > 0, "items", "The bill total must be greater than 0");
  return e;
};

export const finalizeBill = async (id, body, actor) => {
  const finalizedId = await runInTransaction(async (session) => {
    const bill = await load(id, session);
    if (bill.status !== BILL_STATUS.DRAFT || bill.isDeleted) throw bill.status === BILL_STATUS.DRAFT ? ApiError.conflict("This draft was discarded") : ApiError.conflict(`Bill ${bill.billNumber} is already ${bill.status.toLowerCase()}`);
    if (body.revision !== undefined && body.revision !== bill.revision) throw conflictDraftOnly(bill);
    const settings = await loadSettings(session);
    const seller = sellerSnapshot(settings);
    const calc = compute(bill, seller.stateCode, settings);
    const candidate = { ...bill, ...calc };
    const errors = readinessErrors(candidate, seller);
    if (errors.length) throw ApiError.badRequest("This bill is not ready to finalize", errors);

    const financialYear = financialYearOf(bill.billDate);
    const counter = await Counter.findOneAndUpdate({ _id: counterIdFor({ numbering: settings.numbering, financialYear }) }, { $inc: { seq: 1 } }, { new: true, upsert: true, setDefaultsOnInsert: true, session });
    const billNumber = formatBillNumber({ numbering: settings.numbering, financialYear, seq: counter.seq });
    const revision = bill.revision + 1;
    const now = new Date();
    try {
      const result = await Bill.updateOne(
        { _id: id, status: BILL_STATUS.DRAFT, revision: bill.revision, isDeleted: false },
        { $set: { ...calc, status: BILL_STATUS.FINALIZED, billNumber, numberSeries: counterIdFor({ numbering: settings.numbering, financialYear }), financialYear, seller, amountInWords: amountInWords(calc.grandTotalPaise), finalizedAt: now, finalizedBy: actorOf(actor).name, revision, updatedBy: actorOf(actor).id, updatedByName: actorOf(actor).name }, $push: { history: historyRow(BILL_HISTORY.FINALIZE, actor, revision, { fromStatus: BILL_STATUS.DRAFT, toStatus: BILL_STATUS.FINALIZED }) } },
        { session }
      );
      if (!result.matchedCount) throw conflictDraftOnly(bill);
      if (bill.sourceTripIds?.length) {
        // Every Pheera line must still be reserved by THIS draft; otherwise nothing is finalized (the transaction rolls back, number included).
        const marked = await markBilled({ billId: id, billNumber, actor, session });
        if (marked !== bill.sourceTripIds.length) throw ApiError.conflict("Some Pheera of this draft are no longer reserved for it, so it cannot be finalized. Reload the draft");
      }
    } catch (err) {
      if (err?.code === 11000) throw ApiError.conflict("That bill number is already used. Check the invoice numbering settings and try again");
      throw err;
    }
    return id;
  });
  return toBillDto(await load(finalizedId));
};

// ---- cancel and correct ----------------------------------------------------------------------------------------------------------
export const cancelBill = async (id, body, actor) => {
  const bill = await load(id);
  if (bill.status === BILL_STATUS.CANCELLED) throw ApiError.conflict(`Bill ${bill.billNumber} is already cancelled`);
  if (bill.status !== BILL_STATUS.FINALIZED) throw ApiError.conflict("Only a finalized bill can be cancelled. A draft can be discarded instead");
  const revision = bill.revision + 1;
  const run = async (session) => {
    const result = await Bill.updateOne(
      { _id: id, status: BILL_STATUS.FINALIZED },
      { $set: { status: BILL_STATUS.CANCELLED, cancelledAt: new Date(), cancelledBy: actorOf(actor).name, cancelledReason: body.reason, revision, updatedBy: actorOf(actor).id, updatedByName: actorOf(actor).name }, $push: { history: historyRow(BILL_HISTORY.CANCEL, actor, revision, { fromStatus: BILL_STATUS.FINALIZED, toStatus: BILL_STATUS.CANCELLED, reason: body.reason }) } },
      session ? { session } : undefined
    );
    if (!result.matchedCount) throw ApiError.conflict("This bill was changed by someone else. Reload and try again");
    // The Pheeras stay BILLED (never released automatically); their trail records that the invoice was cancelled.
    if (bill.sourceTripIds?.length) await noteBillCancelled({ billId: id, billNumber: bill.billNumber, reason: body.reason, actor, session });
  };
  await (bill.sourceTripIds?.length ? runInTransaction(run) : run(null));
  return toBillDto(await load(id));
};

/**
 * The correction route: copy a CANCELLED bill into a new draft (new number only when it is finalized).
 * Pheera lines are MOVED, not copied: every Pheera still BILLED on the cancelled invoice is reserved by the new draft in one atomic step
 * and keeps the cancelled invoice reference in its billing history. A Pheera that has meanwhile been released or re-billed is left out
 * and reported in `skippedTrips` (it is never put on two invoices).
 */
export const correctionDraft = async (id, actor) => {
  const bill = await load(id);
  if (bill.status !== BILL_STATUS.CANCELLED) throw ApiError.conflict("Cancel the bill first, then correct it as a new bill");
  const base = { customer: bill.customer, taxMode: bill.taxMode, notes: bill.notes, replacesBillNumber: bill.billNumber, customerId: bill.customerId ?? null };
  const copy = ({ particulars, hsn, quantityMilli, unit, ratePaise, taxRateBp }) => ({ particulars, hsn, quantityMilli, unit, ratePaise, taxRateBp });
  const tripLines = bill.items.filter((i) => i.sourceTripId);
  if (!tripLines.length) return createDraft({}, actor, { ...base, items: bill.items.map(copy) });

  const rows = await TruckTrip.find({ _id: { $in: tripLines.map((i) => String(i.sourceTripId)) } }).lean();
  const byId = new Map(rows.map((r) => [String(r._id), r]));
  const movable = (t) => t && !t.isDeleted && t.billingStatus === BILLING_STATUS.BILLED && String(t.billId) === String(id) && String(t.customerId) === String(bill.customerId);
  const skippedTrips = [];
  const items = [];
  for (const line of bill.items) {
    if (!line.sourceTripId) items.push(copy(line));
    else if (movable(byId.get(String(line.sourceTripId)))) items.push({ ...copy(line), pricingUnit: line.pricingUnit, sourceTripId: String(line.sourceTripId), source: line.source });
    else skippedTrips.push({ tripId: String(line.sourceTripId), reason: "No longer billed on this invoice (it was released or already re-billed)" });
  }
  if (!items.length) throw ApiError.conflict("None of the Pheeras of this invoice can be re-billed any more", skippedTrips.map((t) => ({ field: "items", message: `${t.tripId}: ${t.reason}` })));
  const moveIds = items.filter((i) => i.sourceTripId).map((i) => i.sourceTripId);
  const newId = new mongoose.Types.ObjectId().toString();

  const dto = await runInTransaction(async (session) => {
    if (moveIds.length) {
      await assertCustomersActive([bill.customerId], session); // a correction draft reserves Pheeras again, so an archived customer must be restored first
      const moved = await moveTrips({ tripIds: moveIds, fromBillId: id, fromBillNumber: bill.billNumber, toBillId: newId, customerId: bill.customerId, actor, session });
      if (moved !== moveIds.length) {
        if (!session && moved) await undoMove({ tripIds: moveIds, fromBillId: id, toBillId: newId, actor });
        throw ApiError.conflict("A Pheera of this invoice changed while re-billing. Nothing was moved. Reload and try again");
      }
    }
    try {
      return await createDraft({}, actor, { ...base, items }, { session, fields: { _id: newId, sourceTripIds: moveIds } });
    } catch (err) {
      if (!session && moveIds.length) await undoMove({ tripIds: moveIds, fromBillId: id, toBillId: newId, actor });
      throw err;
    }
  });
  return { ...dto, skippedTrips };
};

// ---- reads ---------------------------------------------------------------------------------------------------------------------
export const getBill = async (id) => toBillDto(await load(id));
export const getBillHistory = async (id) => {
  const bill = await load(id);
  return { id: String(bill._id), billNumber: bill.billNumber ?? null, status: bill.status, history: bill.history ?? [] };
};
export const getBillForPdf = async (id) => {
  const bill = await load(id);
  if (bill.status === BILL_STATUS.DRAFT) throw ApiError.conflict("Finalize the bill before printing it. Drafts have no invoice number");
  return toBillDto(bill);
};

export const buildListFilter = ({ search, status, date, from, to } = {}, { withStatus = true } = {}) => {
  const filter = { isDeleted: { $ne: true } }; // only discarded drafts are hidden; every finalized and cancelled bill always shows
  if (withStatus && status) filter.status = status;
  if (date) filter.billDate = { $gte: date, $lte: date };
  else if (from || to) filter.billDate = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) };
  const term = search?.trim();
  if (term) {
    const re = new RegExp(escapeRegExp(term), "i");
    filter.$or = [{ billNumber: re }, { customerKey: re }];
  }
  return filter;
};

export const listBills = async (query) => {
  const filter = buildListFilter(query);
  const [rows, total, ...counts] = await Promise.all([
    Bill.find(filter).sort({ billDate: -1, createdAt: -1 }).skip((query.page - 1) * query.limit).limit(query.limit).lean(),
    Bill.countDocuments(filter),
    ...Object.values(BILL_STATUS).map((status) => Bill.countDocuments({ ...buildListFilter(query, { withStatus: false }), status })),
  ]);
  const byStatus = Object.fromEntries(Object.values(BILL_STATUS).map((s, i) => [s, counts[i]]));
  return { items: rows.map(toListDto), meta: { page: query.page, limit: query.limit, total, counts: byStatus } };
};

export { SETTINGS_ID };
