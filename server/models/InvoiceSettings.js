import mongoose from "mongoose";
import { DEFAULT_NUMBERING, DEFAULT_UNITS, GSTIN_PATTERN, IFSC_PATTERN, LIMITS, PAN_PATTERN, SETTINGS_ID, STATE_CODE_PATTERN, TAX_MODE, TAX_MODE_VALUES } from "../constants/bill.js";
import { createSchema } from "../utils/schema.js";

// The seller's details for invoices: ONE document (_id "default"), edited by the Owner in Settings. Nothing here is hardcoded in the
// app; a fresh database starts with only the business name. Each finalized bill COPIES these details (Bill.seller), so editing
// Settings later never changes an invoice that was already issued.
const text = (max, extra = {}) => ({ type: String, trim: true, maxlength: max, default: "", ...extra });
const pattern = (re, message) => ({ validator: (v) => !v || re.test(v), message });

const settingsSchema = createSchema({
  _id: { type: String, default: SETTINGS_ID },
  businessName: text(LIMITS.name, { default: "AAYUSH CARTING" }),
  businessDescription: text(LIMITS.description),
  productsLine: text(LIMITS.address), // e.g. the line of materials printed under the business type
  gstin: text(15, { uppercase: true, validate: pattern(GSTIN_PATTERN, "GSTIN is not in the right format") }),
  pan: text(10, { uppercase: true, validate: pattern(PAN_PATTERN, "PAN is not in the right format") }),
  address: text(LIMITS.address),
  phones: { type: [String], default: [] },
  jurisdiction: text(LIMITS.name),
  stateName: text(LIMITS.name),
  stateCode: text(2, { validate: pattern(STATE_CODE_PATTERN, "State code must be a 2-digit code") }),
  bank: {
    bankName: text(LIMITS.name),
    branch: text(LIMITS.name),
    accountNumber: text(30),
    ifsc: text(11, { uppercase: true, validate: pattern(IFSC_PATTERN, "IFSC is not in the right format") }),
  },
  proprietorName: text(LIMITS.name),
  numbering: {
    prefix: text(10, { default: DEFAULT_NUMBERING.prefix }),
    separator: text(1, { default: DEFAULT_NUMBERING.separator }),
    includeFinancialYear: { type: Boolean, default: DEFAULT_NUMBERING.includeFinancialYear },
    padding: { type: Number, min: 1, max: 8, default: DEFAULT_NUMBERING.padding },
  },
  defaultTaxMode: { type: String, enum: TAX_MODE_VALUES, default: TAX_MODE.GST },
  allowedTaxRatesBp: { type: [Number], default: [] }, // empty = any rate from 0 to 100 %
  units: { type: [String], default: () => [...DEFAULT_UNITS] },
  revision: { type: Number, default: 0 },
  updatedBy: { type: String, default: null },
  updatedByName: { type: String, default: null },
});

export default mongoose.models.InvoiceSettings || mongoose.model("InvoiceSettings", settingsSchema);
