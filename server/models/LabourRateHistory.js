import { RATE_TYPE_VALUES } from "../constants/labour.js";
import mongoose from "mongoose";
import { businessDateField, createSchema, moneyField } from "../utils/schema.js";

// Append-only: a rate change adds a row; nothing is edited or deleted. The rate in force on a given day is the latest
// row whose effectiveFrom is on or before that day (see services/labourRates.js). The first row is the "Initial rate".
const labourRateHistorySchema = createSchema({
  labourId: { type: String, required: true, immutable: true, ref: "Labour" },
  rateType: { type: String, enum: RATE_TYPE_VALUES, required: true, immutable: true },
  ratePaise: moneyField({ required: true, min: [1, "ratePaise must be greater than 0"], immutable: true }),
  effectiveFrom: businessDateField({ required: true }),
  reason: { type: String, required: true, trim: true, minlength: 1, maxlength: 200, immutable: true },
  changedBy: { type: String, required: true, immutable: true },
  changedById: { type: String, default: null, immutable: true },
});

// A labour can have only one rate starting on any given day.
labourRateHistorySchema.index({ labourId: 1, effectiveFrom: 1 }, { unique: true });

export default mongoose.models.LabourRateHistory || mongoose.model("LabourRateHistory", labourRateHistorySchema);
