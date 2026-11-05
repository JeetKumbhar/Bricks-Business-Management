import mongoose from "mongoose";
import { LABOUR_ID_PATTERN } from "../constants/labour.js";
import { MAX_MAAPS_PER_ENTRY, MAX_NOTE_LENGTH } from "../constants/production.js";
import { businessDateField, createSchema, moneyField, softDeleteFields } from "../utils/schema.js";

// One Patlavale team's production for one business day. At most ONE live entry per team per date (partial unique index);
// a voided entry frees the slot but stays in the database.
//
// Stored: the maaps typed that day, the payable bricks (maaps x 250, every maap counts, nothing carried forward), the rate
// snapshot in force that day (ratePaise = rupees per 4 maaps = 1,000 payable bricks, in paise) and the earnings worked out
// ONCE from maaps and rate (rounded half up). The season is the one covering the date. Payments live elsewhere and never
// touch this collection.

const snapshotSchema = new mongoose.Schema(
  {
    seasonId: { type: String },
    date: { type: String },
    numberOfMaaps: { type: Number },
    payableBricks: { type: Number },
    note: { type: String },
    earningsPaise: { type: Number },
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

const productionEntrySchema = createSchema({
  teamId: { type: String, required: true, immutable: true, match: LABOUR_ID_PATTERN, ref: "Labour" },
  seasonId: { type: String, required: true, ref: "Season" },
  date: businessDateField({ required: true }),
  numberOfMaaps: {
    type: Number,
    required: true,
    min: [0, "numberOfMaaps cannot be negative"],
    max: [MAX_MAAPS_PER_ENTRY, `numberOfMaaps cannot be more than ${MAX_MAAPS_PER_ENTRY}`],
    validate: { validator: Number.isInteger, message: "numberOfMaaps must be a whole number" },
  },
  payableBricks: { type: Number, required: true, min: 0, validate: { validator: Number.isInteger, message: "payableBricks must be a whole number" } },
  ratePaise: moneyField({ required: true, immutable: true, min: [1, "ratePaise must be greater than 0"] }),
  earningsPaise: moneyField({ required: true }),
  note: { type: String, trim: true, maxlength: MAX_NOTE_LENGTH, default: "" },
  backdatedReason: { type: String, trim: true, maxlength: 200, default: null },
  revision: { type: Number, default: 1, min: 1 },
  history: { type: [correctionSchema], default: [] },
  ...softDeleteFields(),
  createdBy: { type: String, default: null },
  updatedBy: { type: String, default: null },
});

productionEntrySchema.index({ teamId: 1, date: 1 }, { unique: true, partialFilterExpression: { isDeleted: false } });
productionEntrySchema.index({ date: 1, teamId: 1 });
productionEntrySchema.index({ teamId: 1, date: -1 });
productionEntrySchema.index({ seasonId: 1, teamId: 1, date: 1 });

export default mongoose.models.ProductionEntry || mongoose.model("ProductionEntry", productionEntrySchema);
