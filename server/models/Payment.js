import mongoose from "mongoose";
import { LABOUR_ID_PATTERN } from "../constants/labour.js";
import { MAX_NOTE_LENGTH, MAX_REFERENCE_LENGTH, PAYMENT_METHOD_VALUES, PAYMENT_METHODS, PAYMENT_TYPE_VALUES, RECIPIENT_TYPE_VALUES } from "../constants/payments.js";
import { businessDateField, createSchema, moneyField, softDeleteFields } from "../utils/schema.js";

// One money transaction to one recipient (a worker or a Patlavale team). It is NOT a work record: nothing here ever
// reads or changes attendance, maap entries, production or earnings. Payments only move the balance.
//
// History is never erased: a correction keeps what the payment looked like before (who, when, why), and a wrong
// payment is VOIDED (soft delete with a reason). A voided payment stays in the database and is left out of every balance.
// `requestId` is an optional client-chosen key that makes a retried create safe (the same key never creates a second payment).

const snapshotSchema = new mongoose.Schema(
  {
    type: { type: String },
    amountPaise: { type: Number },
    date: { type: String },
    method: { type: String },
    reference: { type: String },
    note: { type: String },
  },
  { _id: false }
);

const correctionSchema = new mongoose.Schema(
  {
    at: { type: Date, required: true },
    by: { type: String, required: true },
    byId: { type: String, default: null },
    reason: { type: String, trim: true, required: true, maxlength: 200 },
    before: { type: snapshotSchema, required: true },
  },
  { _id: false }
);

const paymentSchema = createSchema({
  recipientId: { type: String, required: true, immutable: true, match: LABOUR_ID_PATTERN, ref: "Labour" },
  recipientType: { type: String, required: true, immutable: true, enum: RECIPIENT_TYPE_VALUES },
  type: { type: String, required: true, enum: PAYMENT_TYPE_VALUES },
  amountPaise: moneyField({ required: true, min: [1, "amountPaise must be greater than 0"] }),
  date: businessDateField({ required: true }),
  method: { type: String, enum: PAYMENT_METHOD_VALUES, default: PAYMENT_METHODS.CASH },
  reference: { type: String, trim: true, maxlength: MAX_REFERENCE_LENGTH, default: "" },
  note: { type: String, trim: true, maxlength: MAX_NOTE_LENGTH, default: "" },
  requestId: { type: String, default: null, immutable: true },
  revision: { type: Number, default: 1, min: 1 },
  history: { type: [correctionSchema], default: [] },
  ...softDeleteFields(),
  createdBy: { type: String, default: null },
  updatedBy: { type: String, default: null },
});

// A retried create with the same requestId can never produce a second payment (only string keys are indexed).
paymentSchema.index({ requestId: 1 }, { unique: true, partialFilterExpression: { requestId: { $type: "string" } } });
paymentSchema.index({ recipientId: 1, date: -1 });
paymentSchema.index({ date: -1 });

export default mongoose.models.Payment || mongoose.model("Payment", paymentSchema);
