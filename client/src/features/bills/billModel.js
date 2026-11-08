// Constants and shapes for Bills & Invoices. Field names and limits follow the Phase 11 backend (server/constants/bill.js).
//
// Bill (same names as the backend): { id, billNumber (null for a draft), billDate "YYYY-MM-DD" (IST), status, taxMode "GST" | "NON_GST",
//   customer, items, notes, seller (settings snapshot), revision, isDemo, createdAt, updatedAt, finalizedAt?, cancelledAt?, cancelledReason? }
// customer: { name, address, gstin, stateName, stateCode, contact }
// item:     { particulars, hsn, quantity (number), unit, rate (number, Rs per unit), taxRate (number, total GST %, null when blank) }
// seller:   { businessName, businessDescription, productsLine, gstin, pan, address, phones [], jurisdiction, stateName, stateCode,
//             bank { bankName, branch, accountNumber, ifsc }, proprietorName }
// An item's "Tax %" is the TOTAL GST rate: 18 gives CGST 9 + SGST 9 (same state) or IGST 18 (other state).
// CGST + SGST or IGST is never chosen by hand: it comes from the seller's and the customer's state codes.

export const BILL_STATUS = { DRAFT: "DRAFT", FINAL: "FINALIZED", CANCELLED: "CANCELLED" };

export const STATUS_META = {
  DRAFT: { label: "Draft", variant: "warning" },
  FINALIZED: { label: "Finalized", variant: "success" },
  CANCELLED: { label: "Cancelled", variant: "danger" },
};

export const TAX_MODE = { GST: "GST", NON_GST: "NON_GST" };
export const TAX_TYPE = { INTRA: "INTRA", INTER: "INTER" }; // INTRA = CGST + SGST, INTER = IGST

export const TAX_MODE_LABELS = { GST: "GST invoice", NON_GST: "Non-GST bill" };
export const TAX_TYPE_LABELS = { INTRA: "CGST + SGST", INTER: "IGST" };

// Limits copied from the backend validators (server/constants/bill.js)
export const LIMITS = { name: 120, address: 300, particulars: 200, unit: 20, notes: 500, reason: 200, description: 200 };
export const MAX_ITEMS_PER_BILL = 100;
export const MAX_QUANTITY = 1_000_000; // units
export const MAX_RATE = 1_000_000_000; // Rs per unit
export const MAX_TAX_RATE = 100; // percent

/** Quick-fill choices for Particulars. Any text can still be typed. */
export const MATERIAL_OPTIONS = ["Bricks", "Sand", "Stone", "Khadi Matti", "Grawal", "Hard Murram", "Soil"];
export const CUSTOM_MATERIAL = "Other / Custom";

/** Suggested unit when a material is picked (always editable). */
export const defaultUnitFor = (material) => (material === "Bricks" ? "Bricks" : "Tonnes");

/** Units offered in the list; the field also accepts any other text. */
export const UNIT_OPTIONS = ["Bricks", "Pieces", "Tonnes", "Bags", "Loads", "Brass", "Cubic Metre", "Trips"];

export const emptyCustomer = () => ({ name: "", address: "", gstin: "", stateName: "", stateCode: "", contact: "" });

let keyCounter = 0;
const newKey = () => `row-${Date.now().toString(36)}-${(keyCounter += 1)}`;

/** Item as typed in the editor (everything is text until it is validated). */
export const emptyItemDraft = (defaults = {}) => ({ key: newKey(), particulars: "", hsn: "", quantity: "", unit: "", rate: "", taxRate: "", ...defaults });

/** A saved item -> editor text fields */
export const itemToDraft = (item) => ({
  key: newKey(),
  particulars: item.particulars,
  hsn: item.hsn ?? "",
  quantity: item.quantity === null || item.quantity === undefined ? "" : String(item.quantity),
  unit: item.unit,
  rate: item.rate === null || item.rate === undefined ? "" : String(item.rate),
  taxRate: item.taxRate === null || item.taxRate === undefined ? "" : String(item.taxRate),
});
