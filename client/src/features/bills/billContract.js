// The ONE place that knows the exact request and response shapes of the Phase 11 backend (POST/PATCH /api/bills, /api/invoice-settings).
// Everything else in the Bills frontend uses the same field names, so these mappers stay small. They are NOT connected to the API yet:
// the in-memory service (services/billService.js) uses them so that the mock and the real API accept and return the same shapes.
//
// Requests are STRICT on the server: unknown fields (totals, tax amounts, status, bill number ...) are rejected, because the server
// calculates every figure itself. Quantity, rate and tax rate are sent as JSON NUMBERS (never text).
import { TAX_MODE } from "./billModel";

export const SELLER_FIELDS = ["businessName", "businessDescription", "productsLine", "gstin", "pan", "address", "phones", "jurisdiction", "stateName", "stateCode", "bank", "proprietorName"];

/** The seller details frozen on a bill (the same fields the backend copies at finalize). */
export const sellerSnapshot = (settings) => Object.fromEntries(SELLER_FIELDS.map((k) => [k, structuredClone(settings?.[k] ?? (k === "phones" ? [] : k === "bank" ? {} : ""))]));

/**
 * Body of POST /api/bills (create a draft) and PATCH /api/bills/:id (update a draft, add `revision`).
 * value: the checked bill from validators/billValidator.validateBillInput.
 */
export const toBillRequest = (value, revision) => ({
  billDate: value.billDate,
  customer: {
    name: value.customer.name,
    address: value.customer.address,
    gstin: value.customer.gstin,
    stateName: value.customer.stateName,
    stateCode: value.customer.stateCode,
    contact: value.customer.contact,
  },
  taxMode: value.taxMode,
  items: value.items.map((it) => ({
    particulars: it.particulars,
    hsn: it.hsn,
    ...(it.quantity === null ? {} : { quantity: it.quantity }),
    unit: it.unit,
    ...(it.rate === null ? {} : { rate: it.rate }),
    taxRate: value.taxMode === TAX_MODE.GST ? it.taxRate : null,
  })),
  notes: value.notes ?? "",
  ...(revision === undefined ? {} : { revision }),
});

/** Body of POST /api/bills/:id/finalize. The person confirms the review in the dialog, so reviewed is always true here. */
export const toFinalizeRequest = (revision) => ({ reviewed: true, ...(revision === undefined ? {} : { revision }) });

/** Body of POST /api/bills/:id/cancel (a reason of at least 3 characters is required). */
export const toCancelRequest = (reason) => ({ reason: String(reason ?? "").trim() });

/** Body of PATCH /api/invoice-settings. Phones are a list, the bank and numbering are objects, tax rates are numbers. */
export const toSettingsRequest = (s) => ({
  businessName: String(s.businessName ?? "").trim(),
  businessDescription: String(s.businessDescription ?? "").trim(),
  productsLine: String(s.productsLine ?? "").trim(),
  gstin: String(s.gstin ?? "").replace(/\s+/g, "").toUpperCase(),
  pan: String(s.pan ?? "").trim().toUpperCase(),
  address: String(s.address ?? "").trim(),
  phones: (s.phones ?? []).map((p) => String(p).trim()).filter(Boolean),
  jurisdiction: String(s.jurisdiction ?? "").trim(),
  stateName: String(s.stateName ?? "").trim(),
  stateCode: String(s.stateCode ?? "").trim(),
  bank: {
    bankName: String(s.bank?.bankName ?? "").trim(),
    branch: String(s.bank?.branch ?? "").trim(),
    accountNumber: String(s.bank?.accountNumber ?? "").trim(),
    ifsc: String(s.bank?.ifsc ?? "").trim().toUpperCase(),
  },
  proprietorName: String(s.proprietorName ?? "").trim(),
  numbering: {
    prefix: String(s.numbering?.prefix ?? "").trim(),
    separator: s.numbering?.separator ?? "",
    includeFinancialYear: Boolean(s.numbering?.includeFinancialYear),
    padding: s.numbering?.padding,
  },
  defaultTaxMode: s.defaultTaxMode,
  allowedTaxRates: (s.allowedTaxRates ?? []).map(Number),
  units: (s.units ?? []).map((u) => String(u).trim()).filter(Boolean),
});

/** A bill from the API -> the shape the screens use. The API sends the rate in paise; the screens use rupees. */
export const fromBillDto = (dto) => ({
  ...dto,
  items: (dto.items ?? []).map((it) => ({ particulars: it.particulars, hsn: it.hsn ?? "", quantity: it.quantity, unit: it.unit, rate: it.ratePaise / 100, taxRate: it.taxRate ?? null })),
  customer: { name: "", address: "", gstin: "", stateName: "", stateCode: "", contact: "", ...dto.customer },
  notes: dto.notes ?? "",
});

/** Settings from the API -> the shape the screens use (missing lists become empty lists). */
export const fromSettingsDto = (dto) => ({
  ...dto,
  phones: dto.phones ?? [],
  bank: { bankName: "", branch: "", accountNumber: "", ifsc: "", ...dto.bank },
  numbering: dto.numbering,
  allowedTaxRates: dto.allowedTaxRates ?? [],
  units: dto.units ?? [],
});
