import mongoose from "mongoose";
import { PRICING_UNIT, PRICING_UNIT_VALUES } from "../constants/billing.js";
import { BILL_HISTORY, BILL_STATUS, BILL_STATUS_VALUES, LIMITS, TAX_MODE, TAX_MODE_VALUES, TAX_TYPE } from "../constants/bill.js";
import { businessDateField, createSchema, moneyField, softDeleteFields } from "../utils/schema.js";

// One document per bill. Money is integer paise, quantity is integer milli-units, tax rate is integer basis points.
//  - DRAFT: editable, has NO bill number (so abandoned drafts never use up an invoice number). Seller is not copied yet.
//  - FINALIZED: bill number allocated, seller details copied into `seller`, every figure frozen. Cannot be edited.
//  - CANCELLED: a finalized bill that was cancelled with a reason. Keeps its number and all its data; the number is never reused.
// The totals are always recalculated by the server; the client's numbers are never stored.
const line = { type: String, trim: true, default: "" };

// Display copy of the Pheera a line came from (read only; the Pheera itself is the source of truth).
const sourceSchema = new mongoose.Schema(
  { pheeraNo: Number, truckNumber: String, businessDate: String, materialName: String, destination: String, quantity: Number, unit: String },
  { _id: false }
);

const itemSchema = new mongoose.Schema(
  {
    particulars: { type: String, trim: true, maxlength: LIMITS.particulars, default: "" },
    hsn: { type: String, trim: true, default: "" },
    quantityMilli: { type: Number, min: 0, default: 0, validate: Number.isSafeInteger },
    unit: { type: String, trim: true, maxlength: LIMITS.unit, default: "" },
    ratePaise: moneyField({ default: 0 }),
    taxRateBp: { type: Number, min: 0, max: 10000, default: null },
    taxablePaise: moneyField({ default: 0 }),
    cgstPaise: moneyField({ default: 0 }),
    sgstPaise: moneyField({ default: 0 }),
    igstPaise: moneyField({ default: 0 }),
    totalPaise: moneyField({ default: 0 }),
    // Pheera lines only. PER_UNIT (default, every manual line) = rate per unit; PER_THOUSAND = rate per 1,000 (bricks).
    pricingUnit: { type: String, enum: PRICING_UNIT_VALUES, default: PRICING_UNIT.PER_UNIT },
    sourceTripId: { type: mongoose.Schema.Types.ObjectId, ref: "TruckTrip", default: null },
    source: { type: sourceSchema, default: null },
  },
  { _id: false }
);

const sellerSchema = new mongoose.Schema(
  {
    businessName: line, businessDescription: line, productsLine: line, gstin: line, pan: line, address: line, phones: [String], jurisdiction: line, stateName: line, stateCode: line,
    bank: { bankName: line, branch: line, accountNumber: line, ifsc: line },
    proprietorName: line,
  },
  { _id: false }
);

const historySchema = new mongoose.Schema(
  {
    action: { type: String, enum: Object.values(BILL_HISTORY), required: true },
    at: { type: Date, required: true },
    by: { type: String, required: true },
    byId: { type: String, default: null },
    fromStatus: { type: String, default: null },
    toStatus: { type: String, default: null },
    reason: { type: String, default: null },
    revision: { type: Number, required: true },
  },
  { _id: false }
);

const billSchema = createSchema({
  status: { type: String, enum: BILL_STATUS_VALUES, default: BILL_STATUS.DRAFT, required: true, index: true },
  billNumber: { type: String, default: undefined }, // absent on drafts; unique index below
  numberSeries: { type: String, default: null },
  financialYear: { type: String, default: null },
  billDate: businessDateField({ required: true }),
  seller: { type: sellerSchema, default: null },
  customer: {
    name: line, address: line, gstin: line, stateName: line, stateCode: line, contact: line,
  },
  customerKey: { type: String, default: "" }, // lower-case name, for search
  customerId: { type: mongoose.Schema.Types.ObjectId, ref: "Customer", default: null }, // null on manual bills typed by hand
  sourceTripIds: { type: [mongoose.Schema.Types.ObjectId], default: [] }, // Pheeras on this bill (the Pheera's billId is authoritative)
  requestId: { type: String, default: null }, // idempotency key of "generate from Pheeras"
  taxMode: { type: String, enum: TAX_MODE_VALUES, default: TAX_MODE.GST },
  taxType: { type: String, enum: [...Object.values(TAX_TYPE), null], default: null },
  taxPending: { type: Boolean, default: false },
  items: { type: [itemSchema], default: [] },
  taxableTotalPaise: moneyField({ default: 0 }),
  cgstPaise: moneyField({ default: 0 }),
  sgstPaise: moneyField({ default: 0 }),
  igstPaise: moneyField({ default: 0 }),
  grandTotalPaise: moneyField({ default: 0 }),
  amountInWords: { type: String, default: "" },
  notes: { type: String, trim: true, maxlength: LIMITS.notes, default: "" },
  replacesBillNumber: { type: String, default: null }, // set when this draft re-issues a cancelled bill
  finalizedAt: { type: Date, default: null },
  finalizedBy: { type: String, default: null },
  cancelledAt: { type: Date, default: null },
  cancelledBy: { type: String, default: null },
  cancelledReason: { type: String, trim: true, default: null },
  revision: { type: Number, default: 1 },
  history: { type: [historySchema], default: [] },
  ...softDeleteFields(),
  createdBy: { type: String, default: null },
  createdByName: { type: String, default: null },
  updatedBy: { type: String, default: null },
  updatedByName: { type: String, default: null },
});

billSchema.index({ billNumber: 1 }, { unique: true, partialFilterExpression: { billNumber: { $type: "string" } } });
billSchema.index({ billDate: -1, status: 1 });
billSchema.index({ customerKey: 1 });
billSchema.index({ requestId: 1 }, { unique: true, partialFilterExpression: { requestId: { $type: "string" } } });
billSchema.index({ sourceTripIds: 1 });

export default mongoose.models.Bill || mongoose.model("Bill", billSchema);
