import mongoose from "mongoose";
import { businessDateField, createSchema } from "../utils/schema.js";

// The permanent record that a season was closed, with the totals at that moment. ONE per season (unique index). It is written once, inside the
// closing transaction, and never changed or removed: every update, replace, delete and re-save is refused here, so not even a later bug can
// rewrite history. What happens afterwards (settlement payments, carry-forward decisions) is recorded in separate collections that point at it.

const OPS = ["updateOne", "updateMany", "findOneAndUpdate", "findOneAndReplace", "replaceOne", "findOneAndDelete", "deleteOne", "deleteMany", "bulkWrite"];
export const IMMUTABLE_MESSAGE = "Settlement records are permanent and cannot be changed or deleted";

/** Makes a schema append-only: inserts are allowed, every later change or removal throws. */
export const refuseChanges = () => {
  throw Object.assign(new Error(IMMUTABLE_MESSAGE), { code: "IMMUTABLE_RECORD" });
};
export const makeAppendOnly = (schema) => {
  for (const op of OPS) schema.pre(op, refuseChanges);
  schema.pre("deleteOne", { document: true, query: false }, refuseChanges);
  schema.pre("save", function refuseResave() {
    if (!this.isNew) refuseChanges();
  });
  return schema;
};

const money = { type: Number, required: true, immutable: true };
const person = new mongoose.Schema({ id: { type: String, default: null }, name: { type: String, default: null } }, { _id: false });

const settlementSchema = createSchema({
  seasonId: { type: String, required: true, immutable: true, ref: "Season" },
  seasonName: { type: String, required: true, immutable: true },
  startDate: businessDateField({ required: true, immutable: true }),
  endDate: businessDateField({ required: true, immutable: true }),
  ledgerDate: businessDateField({ required: true, immutable: true }), // the books date of settlement payments = the season end date
  closedAt: { type: Date, required: true, immutable: true },
  closedBy: { type: person, required: true, immutable: true },
  seasonRevisionBefore: { type: Number, required: true, immutable: true }, // the revision the Owner previewed and confirmed
  schemaVersion: { type: Number, required: true, immutable: true },
  // The accounting policy the figures were calculated under (are Bayana / Other payments counted as received?).
  policy: { type: mongoose.Schema.Types.Mixed, required: true, immutable: true },
  totals: {
    type: new mongoose.Schema(
      {
        workers: money,
        payableWorkers: money,
        recoverableWorkers: money,
        zeroWorkers: money,
        openingPaise: money,
        earnedPaise: money,
        receivedPaise: money,
        payablePaise: money,
        recoverablePaise: money,
      },
      { _id: false }
    ),
    required: true,
    immutable: true,
  },
  warnings: { type: [mongoose.Schema.Types.Mixed], default: [], immutable: true },
  notIncluded: { type: Number, default: 0, immutable: true },
});

// Exactly one settlement per season, enforced by the database.
settlementSchema.index({ seasonId: 1 }, { unique: true });
makeAppendOnly(settlementSchema);

export default mongoose.models.SeasonSettlement || mongoose.model("SeasonSettlement", settlementSchema);
