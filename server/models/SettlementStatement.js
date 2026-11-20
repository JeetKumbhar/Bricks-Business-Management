import mongoose from "mongoose";
import { LABOUR_ID_PATTERN, LABOUR_STATUS_VALUES, LABOUR_TYPE_VALUES } from "../constants/labour.js";
import { createSchema } from "../utils/schema.js";
import { makeAppendOnly } from "./SeasonSettlement.js";

// One worker's permanent closing statement for one season, written once when the season is closed and never changed or removed.
// It keeps every figure (integer paise) AND the source lines behind them (each with the id of the attendance / Maapvali / production /
// payment record), so the statement can be checked against the work and payment records at any time, even after rates or work change.
// A negative balance is stored as RECOVERABLE with requiresExplicitDecision: the Owner's carry-forward decision is recorded elsewhere (it is
// never written into, or silently assumed by, this statement).

const paise = { type: Number, required: true, immutable: true };

const statementSchema = createSchema({
  settlementId: { type: String, required: true, immutable: true, ref: "SeasonSettlement" },
  seasonId: { type: String, required: true, immutable: true, ref: "Season" },
  labourId: { type: String, required: true, immutable: true, match: LABOUR_ID_PATTERN, ref: "Labour" },
  name: { type: String, required: true, immutable: true },
  labourType: { type: String, required: true, immutable: true, enum: LABOUR_TYPE_VALUES },
  labourStatus: { type: String, required: true, immutable: true, enum: LABOUR_STATUS_VALUES },
  status: { type: String, required: true, immutable: true, enum: ["PAYABLE", "RECOVERABLE", "ZERO"] },
  openingPaise: paise,
  earnedPaise: paise,
  bayanaPaise: paise,
  salaryPaise: paise,
  otherPaise: paise,
  receivedPaise: paise,
  closingPaise: paise,
  payablePaise: paise,
  recoverablePaise: paise,
  work: { type: mongoose.Schema.Types.Mixed, required: true, immutable: true },
  workLines: { type: Number, required: true, immutable: true },
  paymentLines: { type: Number, required: true, immutable: true },
  openingLineCount: { type: Number, required: true, immutable: true },
  afterEnd: { type: mongoose.Schema.Types.Mixed, required: true, immutable: true },
  missingRateDays: { type: Number, default: 0, immutable: true },
  resolution: { type: mongoose.Schema.Types.Mixed, required: true, immutable: true },
  lines: { type: [mongoose.Schema.Types.Mixed], default: [], immutable: true },
});

statementSchema.index({ seasonId: 1, labourId: 1 }, { unique: true });
statementSchema.index({ labourId: 1 });
makeAppendOnly(statementSchema);

export default mongoose.models.SettlementStatement || mongoose.model("SettlementStatement", statementSchema);
