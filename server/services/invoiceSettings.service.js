import { BILL_STATUS, DEFAULT_NUMBERING, DEFAULT_UNITS, SETTINGS_ID } from "../constants/bill.js";
import Bill from "../models/Bill.js";
import InvoiceSettings from "../models/InvoiceSettings.js";
import ApiError from "../utils/ApiError.js";
import { runInTransaction } from "../utils/transaction.js";
import { bpToPercent, gstinMatchesState, parseBp } from "../utils/billRules.js";

// Seller / invoice settings: ONE document the Owner edits. Reads fall back to safe defaults when nothing is saved yet.
const defaults = () => ({ _id: SETTINGS_ID, businessName: "AAYUSH CARTING", businessDescription: "", productsLine: "", gstin: "", pan: "", address: "", phones: [], jurisdiction: "", stateName: "", stateCode: "", bank: { bankName: "", branch: "", accountNumber: "", ifsc: "" }, proprietorName: "", numbering: { ...DEFAULT_NUMBERING }, defaultTaxMode: "GST", allowedTaxRatesBp: [], units: [...DEFAULT_UNITS], revision: 0 });

export const loadSettings = async (session = null) => {
  const query = InvoiceSettings.find({ _id: SETTINGS_ID }).lean();
  const [row] = await (session ? query.session(session) : query);
  const base = defaults();
  return row ? { ...base, ...row, bank: { ...base.bank, ...row.bank }, numbering: { ...base.numbering, ...row.numbering } } : base;
};

export const toSettingsDto = (s, numberingLocked = false) => ({
  businessName: s.businessName, businessDescription: s.businessDescription, productsLine: s.productsLine ?? "", gstin: s.gstin, pan: s.pan, address: s.address, phones: s.phones ?? [], jurisdiction: s.jurisdiction,
  stateName: s.stateName, stateCode: s.stateCode, bank: s.bank, proprietorName: s.proprietorName, numbering: { ...s.numbering, locked: numberingLocked }, defaultTaxMode: s.defaultTaxMode,
  allowedTaxRates: (s.allowedTaxRatesBp ?? []).map(bpToPercent), units: s.units?.length ? s.units : [...DEFAULT_UNITS], revision: s.revision ?? 0, updatedAt: s.updatedAt ?? null, updatedBy: s.updatedByName ?? null,
});

export const getSettings = async () => {
  const settings = await loadSettings();
  return toSettingsDto(settings, await isNumberingLocked(settings));
};

// ---------------------------------------------------------------------------------------------------------------------------------
// Phase 1C (P3): invoice numbering lock.
// Once a bill has been finalized (a cancelled bill was finalized first and keeps its number) the four numbering settings can never change:
// a different prefix / separator / financial-year toggle / padding would start a second numbering scheme next to numbers already issued.
// The lock lives ON the settings document (`numberingLocked`), so the first finalize and a numbering change both write ONE shared
// document with explicit guards, instead of relying on a read that a concurrent commit would not conflict with:
//   - finalize (first time): updateOne({_id, revision: <revision it read>}, {$set: numberingLocked}) inside its own transaction
//   - numbering change: updateOne({_id, revision: <revision it read>, numberingLocked: {$ne: true}}, ...) inside a required transaction
// Whichever commits first wins; the other matches nothing and gets 409, and its transaction (invoice number included) rolls back.
// Bills finalized or cancelled BEFORE this field existed are recognised by looking for such a bill (no migration, no data change).
const NUMBERING_FIELDS = ["prefix", "separator", "includeFinancialYear", "padding"];
const NUMBERING_LABELS = { prefix: "prefix", separator: "separator", includeFinancialYear: "financial-year choice", padding: "number padding" };

const changedNumberingFields = (numbering, current) => NUMBERING_FIELDS.filter((k) => numbering?.[k] !== undefined && numbering[k] !== current.numbering[k]);

/** True when numbering is locked: the flag, or any finalized / cancelled bill (data from before the flag existed). Drafts and discarded drafts never lock. */
export const isNumberingLocked = async (settings, session = null) => {
  if (settings.numberingLocked === true) return true;
  const query = Bill.find({ status: { $in: [BILL_STATUS.FINALIZED, BILL_STATUS.CANCELLED] } }).limit(1).lean();
  return (await (session ? query.session(session) : query)).length > 0;
};

const settingsChanged = (what) => ApiError.conflict(`The invoice settings were changed by someone else while ${what}. Nothing was saved${what.includes("issued") ? " and no invoice number was used" : ""}; try again.`);

/**
 * Called by finalizeBill INSIDE its transaction, with the settings it just read in that transaction. The first finalize sets the lock;
 * later ones return at once (the lock never clears, so there is nothing to coordinate). It does not change `revision`.
 */
export const lockNumbering = async (settings, session = null) => {
  if (settings.numberingLocked === true) return;
  let result;
  try {
    result = await InvoiceSettings.updateOne(
      { _id: SETTINGS_ID, revision: settings.revision ?? 0 },
      { $set: { numberingLocked: true, numberingLockedAt: new Date() } },
      { upsert: true, ...(session ? { session } : {}) }
    );
  } catch (err) {
    if (err?.code === 11000) throw settingsChanged("this bill was being issued"); // the settings document exists with another revision: it changed after we read it
    throw err;
  }
  if (!result.matchedCount && !result.upsertedCount) throw settingsChanged("this bill was being issued");
};

const prepare = (current, body) => {
  const { allowedTaxRates, bank, numbering, ...rest } = body;
  const changed = changedNumberingFields(numbering, current);
  // The numbering block is written ONLY when a numbering field really changes: an identical copy sent by the form is never written back,
  // so a stale copy can never undo a newer value.
  const next = { ...rest, ...(bank ? { bank: { ...current.bank, ...bank } } : {}), ...(changed.length ? { numbering: { ...current.numbering, ...numbering } } : {}), ...(allowedTaxRates ? { allowedTaxRatesBp: [...new Set(allowedTaxRates.map(parseBp))].sort((a, b) => a - b) } : {}) };
  const merged = { ...current, ...next };
  const errors = [];
  if (!gstinMatchesState(merged.gstin, merged.stateCode)) errors.push({ field: "stateCode", message: "The first 2 digits of the GSTIN must match the state code" });
  if (errors.length) throw ApiError.badRequest("Validation failed", errors);
  return { next, changed };
};

const numberingLockedError = (changed) =>
  new ApiError(409, "Invoice numbering can no longer be changed because invoices have already been issued. Other settings can still be edited.", changed.map((field) => ({ field: `numbering.${field}`, message: `The ${NUMBERING_LABELS[field]} is locked: an invoice has already been finalized` })));

const stamp = (current, actor) => ({ revision: (current.revision ?? 0) + 1, updatedBy: actor.id ?? null, updatedByName: actor.name ?? null });

export const updateSettings = async (body, actor) => {
  const current = await loadSettings();
  const plan = prepare(current, body);
  if (plan.changed.length === 0) {
    // No numbering field changes: the long-standing single write (it never touches the numbering block or the lock).
    await InvoiceSettings.updateOne({ _id: SETTINGS_ID }, { $set: { ...plan.next, ...stamp(current, actor) } }, { upsert: true, runValidators: true });
    return getSettings();
  }
  // A numbering change is ONE required transaction: re-read, check the lock, then a write guarded by the revision read here AND by the lock flag.
  await runInTransaction(
    async (session) => {
      const fresh = await loadSettings(session);
      const p = prepare(fresh, body);
      if (p.changed.length && (await isNumberingLocked(fresh, session))) throw numberingLockedError(p.changed);
      try {
        const result = await InvoiceSettings.updateOne(
          { _id: SETTINGS_ID, revision: fresh.revision ?? 0, numberingLocked: { $ne: true } },
          { $set: { ...p.next, ...stamp(fresh, actor) } },
          { upsert: true, runValidators: true, ...(session ? { session } : {}) }
        );
        if (!result.matchedCount && !result.upsertedCount) throw numberingLockedError(p.changed);
      } catch (err) {
        if (err?.code === 11000) throw numberingLockedError(p.changed); // the document exists but no longer matches: locked, or changed, since we read it
        throw err;
      }
    },
    { required: true }
  );
  return getSettings();
};
