import mongoose from "mongoose";
import { createSchema } from "../utils/schema.js";

// A tiny control record, one per closing statement, created the first time a settlement payment is recorded for it. Every settlement payment
// increments `version` inside its transaction BEFORE it reads the remaining balance, so two payments for the same worker cannot be recorded at
// the same moment: one waits (or retries) and then sees the other's payment. It holds no money and no history; the statement stays immutable.

const lockSchema = createSchema({
  statementId: { type: String, required: true, immutable: true },
  seasonId: { type: String, required: true, immutable: true },
  settlementId: { type: String, required: true, immutable: true },
  labourId: { type: String, required: true, immutable: true },
  version: { type: Number, default: 0 },
});

lockSchema.index({ statementId: 1 }, { unique: true });

export default mongoose.models.SettlementLock || mongoose.model("SettlementLock", lockSchema);
