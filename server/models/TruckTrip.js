import mongoose from "mongoose";
import {
  MATERIAL_CATEGORY,
  MATERIAL_CATEGORY_VALUES,
  MAX_DESTINATION,
  MAX_MATERIAL_NAME,
  MAX_REMARKS,
  MATERIAL_RULES,
  UNIT_VALUES,
  UNITS,
} from "../constants/truck.js";
import { BILLING_ACTION_VALUES, BILLING_STATUS_VALUES } from "../constants/billing.js";
import { businessDateField, createSchema, softDeleteFields } from "../utils/schema.js";
import { quantityError } from "../utils/truckRules.js";

// ONE Pheera = ONE transportation round = ONE document. A truck that makes five rounds in a day has five documents; nothing is
// ever grouped. Totals are never stored: they are calculated from the live (not voided) documents.
//
//  - truckId is a real reference to Truck and cannot change. truckNumber is a snapshot, so old reports keep the registration
//    number even if the truck is corrected later.
//  - pheeraNo is assigned by the server per truck and business date (1, 2, 3 ...). Voided numbers are never reused, so "Pheera 3"
//    always means the same trip. The unique index below covers voided records too.
//  - materialCategory is BRICKS, SOIL or OTHER; materialName is the REAL name (Bricks, Soil or e.g. "Stone Dust"), so reports
//    and filters show it. Older names such as Sand, Cement or Stone are simply OTHER records with that name, in tonnes.
//  - unit is stored on every record and always matches the material: bricks for Bricks, tonnes for everything else.
//  - A correction keeps the old values in `history` (who, when, why); a delete is a soft delete ("void") with a reason.

const snapshotSchema = new mongoose.Schema(
  {
    materialCategory: { type: String },
    materialName: { type: String },
    destination: { type: String },
    quantity: { type: Number },
    unit: { type: String },
    remarks: { type: String },
  },
  { _id: false }
);

const auditSchema = new mongoose.Schema(
  {
    action: { type: String, enum: ["CORRECT", "VOID"], required: true },
    revision: { type: Number, required: true },
    at: { type: Date, required: true },
    by: { type: String, required: true },
    byId: { type: String, default: null },
    reason: { type: String, trim: true, required: true, maxlength: 200 },
    before: { type: snapshotSchema, required: true },
  },
  { _id: false }
);

// Billing trail (Pheera <-> Bills integration): every reservation, release, billing, cancellation and re-billing, with the invoice it
// concerned. Appended only; never edited.
const billingHistorySchema = new mongoose.Schema(
  {
    action: { type: String, enum: BILLING_ACTION_VALUES, required: true },
    at: { type: Date, required: true },
    by: { type: String, required: true },
    byId: { type: String, default: null },
    billId: { type: mongoose.Schema.Types.ObjectId, default: null },
    billNumber: { type: String, default: null },
    previousBillId: { type: mongoose.Schema.Types.ObjectId, default: null },
    previousBillNumber: { type: String, default: null },
    customerId: { type: mongoose.Schema.Types.ObjectId, default: null },
    reason: { type: String, default: null },
  },
  { _id: false }
);

const tripSchema = createSchema({
  truckId: { type: mongoose.Schema.Types.ObjectId, ref: "Truck", required: true, immutable: true },
  truckNumber: { type: String, required: true, trim: true },
  businessDate: businessDateField({ required: true, immutable: true }),
  pheeraNo: { type: Number, required: true, immutable: true, min: [1, "pheeraNo starts at 1"], validate: { validator: Number.isInteger, message: "pheeraNo must be a whole number" } },
  materialCategory: { type: String, enum: MATERIAL_CATEGORY_VALUES, required: true },
  materialName: {
    type: String,
    required: true,
    trim: true,
    maxlength: MAX_MATERIAL_NAME,
    validate: {
      validator(value) {
        const fixed = MATERIAL_RULES[this.materialCategory]?.name; // Bricks and Soil have a fixed name; Other has the real one
        return fixed ? value === fixed : value.length > 0;
      },
      message: "materialName does not match the material",
    },
  },
  materialKey: { type: String, required: true },
  destination: { type: String, required: true, trim: true, maxlength: MAX_DESTINATION },
  destinationKey: { type: String, required: true },
  quantity: {
    type: Number,
    required: true,
    validate: {
      validator(value) {
        return quantityError(value, this.unit) === null;
      },
      message: "quantity is not valid for this unit",
    },
  },
  unit: {
    type: String,
    enum: UNIT_VALUES,
    required: true,
    validate: {
      validator(value) {
        return value === (this.materialCategory === MATERIAL_CATEGORY.BRICKS ? UNITS.BRICKS : UNITS.TONNES);
      },
      message: "unit does not match the material (bricks for Bricks, tonnes for everything else)",
    },
  },
  remarks: { type: String, trim: true, maxlength: MAX_REMARKS, default: "" },
  submissionId: { type: String, default: null, immutable: true }, // one id per "Save all"; saving it twice never duplicates
  clientRowId: { type: String, default: null, immutable: true },
  // Billing. All optional so historical Pheeras stay valid (customerId null, billingStatus null = not billable, not locked).
  customerId: { type: mongoose.Schema.Types.ObjectId, ref: "Customer", default: null },
  customerName: { type: String, default: null }, // snapshot, like truckNumber
  billingStatus: { type: String, enum: [...BILLING_STATUS_VALUES, null], default: null },
  billId: { type: mongoose.Schema.Types.ObjectId, ref: "Bill", default: null }, // the ONE authoritative link: which bill holds this Pheera now
  reservedAt: { type: Date, default: null },
  billedAt: { type: Date, default: null },
  billingHistory: { type: [billingHistorySchema], default: [] },
  revision: { type: Number, default: 1, min: 1 },
  history: { type: [auditSchema], default: [] },
  ...softDeleteFields(),
  createdBy: { type: String, default: null },
  createdByName: { type: String, default: null },
  updatedBy: { type: String, default: null },
  updatedByName: { type: String, default: null },
});

// No two Pheera share a number for the same truck and date (voided ones included, because numbers are never reused).
tripSchema.index({ truckId: 1, businessDate: 1, pheeraNo: 1 }, { unique: true });
// The same "Save all" can never be stored twice.
tripSchema.index({ submissionId: 1, clientRowId: 1 }, { unique: true, partialFilterExpression: { submissionId: { $type: "string" } } });
tripSchema.index({ businessDate: 1, truckId: 1 });
tripSchema.index({ materialKey: 1, businessDate: 1 });
tripSchema.index({ destinationKey: 1, businessDate: 1 });
tripSchema.index({ customerId: 1, billingStatus: 1, businessDate: 1 });
tripSchema.index({ billId: 1 });
tripSchema.index({ billingStatus: 1, businessDate: 1 });

export default mongoose.models.TruckTrip || mongoose.model("TruckTrip", tripSchema);
