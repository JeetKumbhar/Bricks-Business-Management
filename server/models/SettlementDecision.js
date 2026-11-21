import mongoose from "mongoose";
import { LABOUR_ID_PATTERN } from "../constants/labour.js";
import { businessDateField, createSchema } from "../utils/schema.js";
import { makeAppendOnly } from "./SeasonSettlement.js";

// The Owner's explicit decision about a worker who was paid MORE than they earned in a closed season (a negative closing balance).
// The only decision is CARRY_FORWARD: the amount stays an outstanding advance and appears as the opening balance of whatever comes next.
// Recording it deducts nothing, pays nothing, writes nothing off and never marks the amount as settled; the closing statement is not touched.
// One per statement (unique), written once, never changed or removed.

const decisionSchema = createSchema({
  seasonId: { type: String, required: true, immutable: true, ref: "Season" },
  settlementId: { type: String, required: true, immutable: true, ref: "SeasonSettlement" },
  statementId: { type: String, required: true, immutable: true, ref: "SettlementStatement" },
  labourId: { type: String, required: true, immutable: true, match: LABOUR_ID_PATTERN, ref: "Labour" },
  kind: { type: String, required: true, immutable: true, enum: ["CARRY_FORWARD"] },
  amountPaise: { type: Number, required: true, immutable: true, min: 1 }, // the original negative amount, as a positive number of paise
  reason: { type: String, required: true, immutable: true, trim: true, minlength: 3, maxlength: 200 },
  decidedAt: { type: Date, required: true, immutable: true },
  decidedBy: { type: new mongoose.Schema({ id: { type: String, default: null }, name: { type: String, default: null } }, { _id: false }), required: true, immutable: true },
  ledgerDate: businessDateField({ required: true, immutable: true }), // the season end date the amount is carried forward from
});

decisionSchema.index({ statementId: 1 }, { unique: true });
decisionSchema.index({ seasonId: 1 });
makeAppendOnly(decisionSchema);

export default mongoose.models.SettlementDecision || mongoose.model("SettlementDecision", decisionSchema);
