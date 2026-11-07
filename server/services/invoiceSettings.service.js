import { DEFAULT_NUMBERING, DEFAULT_UNITS, SETTINGS_ID } from "../constants/bill.js";
import InvoiceSettings from "../models/InvoiceSettings.js";
import ApiError from "../utils/ApiError.js";
import { bpToPercent, gstinMatchesState, parseBp } from "../utils/billRules.js";

// Seller / invoice settings: ONE document the Owner edits. Reads fall back to safe defaults when nothing is saved yet.
const defaults = () => ({ _id: SETTINGS_ID, businessName: "AAYUSH CARTING", businessDescription: "", productsLine: "", gstin: "", pan: "", address: "", phones: [], jurisdiction: "", stateName: "", stateCode: "", bank: { bankName: "", branch: "", accountNumber: "", ifsc: "" }, proprietorName: "", numbering: { ...DEFAULT_NUMBERING }, defaultTaxMode: "GST", allowedTaxRatesBp: [], units: [...DEFAULT_UNITS], revision: 0 });

export const loadSettings = async (session = null) => {
  const query = InvoiceSettings.find({ _id: SETTINGS_ID }).lean();
  const [row] = await (session ? query.session(session) : query);
  const base = defaults();
  return row ? { ...base, ...row, bank: { ...base.bank, ...row.bank }, numbering: { ...base.numbering, ...row.numbering } } : base;
};

export const toSettingsDto = (s) => ({
  businessName: s.businessName, businessDescription: s.businessDescription, productsLine: s.productsLine ?? "", gstin: s.gstin, pan: s.pan, address: s.address, phones: s.phones ?? [], jurisdiction: s.jurisdiction,
  stateName: s.stateName, stateCode: s.stateCode, bank: s.bank, proprietorName: s.proprietorName, numbering: s.numbering, defaultTaxMode: s.defaultTaxMode,
  allowedTaxRates: (s.allowedTaxRatesBp ?? []).map(bpToPercent), units: s.units?.length ? s.units : [...DEFAULT_UNITS], revision: s.revision ?? 0, updatedAt: s.updatedAt ?? null, updatedBy: s.updatedByName ?? null,
});

export const getSettings = async () => toSettingsDto(await loadSettings());

export const updateSettings = async (body, actor) => {
  const current = await loadSettings();
  const { allowedTaxRates, bank, numbering, ...rest } = body;
  const next = { ...rest, ...(bank ? { bank: { ...current.bank, ...bank } } : {}), ...(numbering ? { numbering: { ...current.numbering, ...numbering } } : {}), ...(allowedTaxRates ? { allowedTaxRatesBp: [...new Set(allowedTaxRates.map(parseBp))].sort((a, b) => a - b) } : {}) };
  const merged = { ...current, ...next };
  const errors = [];
  if (!gstinMatchesState(merged.gstin, merged.stateCode)) errors.push({ field: "stateCode", message: "The first 2 digits of the GSTIN must match the state code" });
  if (errors.length) throw ApiError.badRequest("Validation failed", errors);
  await InvoiceSettings.updateOne({ _id: SETTINGS_ID }, { $set: { ...next, revision: (current.revision ?? 0) + 1, updatedBy: actor.id ?? null, updatedByName: actor.name ?? null } }, { upsert: true, runValidators: true });
  return getSettings();
};
