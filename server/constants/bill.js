// Bills & invoices (Phase 11). No tax rate, GSTIN or business detail is hardcoded here: rates and seller details are entered by the
// owner in Settings and checked by shape only.
export const BILL_STATUS = Object.freeze({ DRAFT: "DRAFT", FINALIZED: "FINALIZED", CANCELLED: "CANCELLED" });
export const BILL_STATUS_VALUES = Object.freeze(Object.values(BILL_STATUS));
export const TAX_MODE = Object.freeze({ GST: "GST", NON_GST: "NON_GST" });
export const TAX_MODE_VALUES = Object.freeze(Object.values(TAX_MODE));
export const TAX_TYPE = Object.freeze({ INTRA: "INTRA", INTER: "INTER" }); // INTRA = CGST + SGST, INTER = IGST
export const BILL_HISTORY = Object.freeze({ CREATE: "CREATE", UPDATE: "UPDATE", FINALIZE: "FINALIZE", CANCEL: "CANCEL", DISCARD: "DISCARD" });

// Shapes only (the business must verify the real numbers). GSTIN: 2-digit state code, PAN, entity digit, Z, check character.
export const GSTIN_PATTERN = /^(0[1-9]|[1-3]\d|3[0-8])[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
export const PAN_PATTERN = /^[A-Z]{5}\d{4}[A-Z]$/;
export const IFSC_PATTERN = /^[A-Z]{4}0[A-Z0-9]{6}$/;
export const STATE_CODE_PATTERN = /^(0[1-9]|[1-3]\d|3[0-8]|9[79])$/;
export const HSN_PATTERN = /^\d{4}(\d{2}(\d{2})?)?$/; // 4, 6 or 8 digits (SAC is 6)
export const PHONE_PATTERN = /^[0-9+\-() ]{6,20}$/;

export const MAX_ITEMS_PER_BILL = 100;
export const MAX_QUANTITY_DECIMALS = 3;
export const MAX_QUANTITY_MILLI = 1_000_000_000; // 1,000,000 units
export const MAX_RATE_PAISE = 100_000_000_000; // Rs 1,000,000,000 per unit
export const MAX_TAX_RATE_BP = 10_000; // 100.00 %
export const MAX_BILL_TOTAL_PAISE = 9_000_000_000_000_000; // stays inside safe integers
export const LIMITS = Object.freeze({ name: 120, address: 300, particulars: 200, unit: 20, notes: 500, reason: 200, description: 200 });

export const DEFAULT_UNITS = Object.freeze(["bricks", "tonnes", "trips", "kg", "cubic metre"]);
export const DEFAULT_NUMBERING = Object.freeze({ prefix: "AC", separator: "/", includeFinancialYear: true, padding: 4 });
export const SETTINGS_ID = "default";
