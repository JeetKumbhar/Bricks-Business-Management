import { BILL_HISTORY, BILL_STATUS, MAX_BILL_TOTAL_PAISE, SETTINGS_ID, TAX_MODE } from "../constants/bill.js";
import Bill from "../models/Bill.js";
import Counter from "../models/Counter.js";
import ApiError from "../utils/ApiError.js";
import { amountInWords } from "../utils/amountInWords.js";
import { bpToPercent, counterIdFor, financialYearOf, formatBillNumber, milliToNumber, parseBp, parseMilli, parseRupeesToPaise } from "../utils/billRules.js";
import { isFutureBusinessDate, toBusinessDate, todayBusinessDate } from "../utils/dates.js";
import { runInTransaction } from "../utils/transaction.js";
import { escapeRegExp } from "../utils/truckRules.js";
import { calculateBill, deriveTaxType } from "./billCalculations.js";
import { loadSettings } from "./invoiceSettings.service.js";

// Bills. Policy (documented in the Phase 11 report):
//  - A DRAFT has no bill number, so abandoned drafts never use one up. The number is allocated only when the owner FINALIZES.
//  - Numbers come from an atomic counter per prefix + financial year, inside the same transaction as the finalize, so two bills
//    finalized at the same moment get different numbers and a failed finalize does not burn a number.
//  - FINALIZED is frozen: no edit. A mistake is fixed by CANCEL (reason required; number kept, never reused) and a new bill.
//  - Every figure is recalculated here from quantity, rate and tax rate. Totals sent by a client are rejected by the validators.
const SELLER_FIELDS = ["businessName", "businessDescription", "productsLine", "gstin", "pan", "address", "phones", "jurisdiction", "stateName", "stateCode", "bank", "proprietorName"];
const gstOf = (b) => b.cgstPaise + b.sgstPaise + b.igstPaise;
const actorOf = (actor) => ({ id: actor.id ?? null, name: actor.name ?? "Unknown" });
const historyRow = (action, actor, revision, extra = {}) => ({ action, at: new Date(), by: actorOf(actor).name, byId: actorOf(actor).id, fromStatus: null, toStatus: null, reason: null, revision, ...extra });

const conflictDraftOnly = (bill) => ApiError.conflict(bill.status === BILL_STATUS.DRAFT ? "This draft was changed by someone else. Reload and try again" : `Bill ${bill.billNumber} is ${bill.status.toLowerCase()} and can no longer be edited. Cancel it and issue a new bill instead`);

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
const compute = ({ items, taxMode, customer }, sellerStateCode, settings) => {
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
const itemDto = (i) => ({ particulars: i.particulars, hsn: i.hsn, quantity: milliToNumber(i.quantityMilli), quantityMilli: i.quantityMilli, unit: i.unit, ratePaise: i.ratePaise, taxRate: bpToPercent(i.taxRateBp), taxRateBp: i.taxRateBp, taxablePaise: i.taxablePaise, cgstPaise: i.cgstPaise, sgstPaise: i.sgstPaise, igstPaise: i.igstPaise, totalPaise: i.totalPaise });

export const toListDto = (b) => ({
  id: String(b._id), billNumber: b.billNumber ?? null, status: b.status, billDate: b.billDate, customerName: b.customer?.name ?? "", customerGstin: b.customer?.gstin ?? "",
  taxMode: b.taxMode, taxableTotalPaise: b.taxableTotalPaise, gstPaise: gstOf(b), grandTotalPaise: b.grandTotalPaise, itemCount: b.items?.length ?? 0, finalizedAt: b.finalizedAt ?? null, cancelledAt: b.cancelledAt ?? null, createdAt: b.createdAt,
});

export const toBillDto = (b) => ({
  ...toListDto(b),
  customer: b.customer, taxType: b.taxType ?? null, taxPending: Boolean(b.taxPending), items: (b.items ?? []).map(itemDto), cgstPaise: b.cgstPaise, sgstPaise: b.sgstPaise, igstPaise: b.igstPaise,
  amountInWords: b.amountInWords || amountInWords(b.grandTotalPaise), notes: b.notes ?? "", seller: b.seller ?? null, numberSeries: b.numberSeries ?? null, financialYear: b.financialYear ?? null,
  replacesBillNumber: b.replacesBillNumber ?? null, revision: b.revision, finalizedBy: b.finalizedBy ?? null,
  finalizedOn: b.finalizedAt ? toBusinessDate(b.finalizedAt) : null, cancelledOn: b.cancelledAt ? toBusinessDate(b.cancelledAt) : null, cancelledBy: b.cancelledBy ?? null, cancelledReason: b.cancelledReason ?? null,
  createdBy: b.createdByName ?? null, updatedBy: b.updatedByName ?? null, updatedAt: b.updatedAt, history: b.history ?? [],
});

const load = async (id, session = null) => {
  const query = Bill.find({ _id: id }).lean();
  const [bill] = await (session ? query.session(session) : query);
  if (!bill) throw ApiError.notFound("Bill not found");
  return bill;
};

// ---- drafts --------------------------------------------------------------------------------------------------------------------
export const createDraft = async (body, actor, base = {}) => {
  const settings = await loadSettings();
  const taxMode = body.taxMode ?? base.taxMode ?? settings.defaultTaxMode;
  const customer = customerOf(body.customer, base.customer);
  const items = (body.items ?? base.items ?? []).map((i) => (i.quantityMilli === undefined ? toItem(i) : i));
  const calc = compute({ items, taxMode, customer }, settings.stateCode, settings);
  const billDate = body.billDate ?? todayBusinessDate();
  const [created] = await Bill.insertMany([
    {
      status: BILL_STATUS.DRAFT, billDate, customer, customerKey: customer.name.toLowerCase(), taxMode, notes: body.notes ?? base.notes ?? "", ...calc, amountInWords: "", revision: 1,
      replacesBillNumber: base.replacesBillNumber ?? null, history: [historyRow(BILL_HISTORY.CREATE, actor, 1, { toStatus: BILL_STATUS.DRAFT })],
      isDeleted: false, createdBy: actorOf(actor).id, createdByName: actorOf(actor).name, updatedBy: actorOf(actor).id, updatedByName: actorOf(actor).name,
    },
  ]);
  return toBillDto(created.toObject ? created.toObject() : created);
};

export const updateDraft = async (id, body, actor) => {
  const bill = await load(id);
  if (bill.status !== BILL_STATUS.DRAFT || bill.isDeleted) throw conflictDraftOnly(bill);
  if (body.revision !== undefined && body.revision !== bill.revision) throw conflictDraftOnly(bill);
  const settings = await loadSettings();
  const taxMode = body.taxMode ?? bill.taxMode;
  const customer = customerOf(body.customer, bill.customer);
  const items = body.items ? body.items.map(toItem) : bill.items;
  const calc = compute({ items, taxMode, customer }, settings.stateCode, settings);
  const revision = bill.revision + 1;
  const result = await Bill.updateOne(
    { _id: id, status: BILL_STATUS.DRAFT, revision: bill.revision, isDeleted: false },
    { $set: { billDate: body.billDate ?? bill.billDate, customer, customerKey: customer.name.toLowerCase(), taxMode, notes: body.notes ?? bill.notes, ...calc, revision, updatedBy: actorOf(actor).id, updatedByName: actorOf(actor).name }, $push: { history: historyRow(BILL_HISTORY.UPDATE, actor, revision) } }
  );
  if (!result.matchedCount) throw conflictDraftOnly(bill);
  return toBillDto(await load(id));
};

export const discardDraft = async (id, body, actor) => {
  const bill = await load(id);
  if (bill.status !== BILL_STATUS.DRAFT) throw ApiError.conflict(`Only drafts can be discarded. Bill ${bill.billNumber} must be cancelled instead`);
  if (bill.isDeleted) return toBillDto(bill);
  const revision = bill.revision + 1;
  const result = await Bill.updateOne({ _id: id, status: BILL_STATUS.DRAFT, isDeleted: false }, { $set: { isDeleted: true, deletedAt: new Date(), deletedBy: actorOf(actor).name, deletedReason: body.reason ?? null, revision }, $push: { history: historyRow(BILL_HISTORY.DISCARD, actor, revision, { fromStatus: BILL_STATUS.DRAFT, reason: body.reason ?? null }) } });
  if (!result.matchedCount) throw conflictDraftOnly(bill);
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
  const result = await Bill.updateOne(
    { _id: id, status: BILL_STATUS.FINALIZED },
    { $set: { status: BILL_STATUS.CANCELLED, cancelledAt: new Date(), cancelledBy: actorOf(actor).name, cancelledReason: body.reason, revision, updatedBy: actorOf(actor).id, updatedByName: actorOf(actor).name }, $push: { history: historyRow(BILL_HISTORY.CANCEL, actor, revision, { fromStatus: BILL_STATUS.FINALIZED, toStatus: BILL_STATUS.CANCELLED, reason: body.reason }) } }
  );
  if (!result.matchedCount) throw ApiError.conflict("This bill was changed by someone else. Reload and try again");
  return toBillDto(await load(id));
};

/** The correction route: copy a CANCELLED bill into a new draft (new number only when it is finalized). */
export const correctionDraft = async (id, actor) => {
  const bill = await load(id);
  if (bill.status !== BILL_STATUS.CANCELLED) throw ApiError.conflict("Cancel the bill first, then correct it as a new bill");
  return createDraft({}, actor, { customer: bill.customer, taxMode: bill.taxMode, notes: bill.notes, items: bill.items.map(({ particulars, hsn, quantityMilli, unit, ratePaise, taxRateBp }) => ({ particulars, hsn, quantityMilli, unit, ratePaise, taxRateBp })), replacesBillNumber: bill.billNumber });
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
