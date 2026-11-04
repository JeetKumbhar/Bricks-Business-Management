import mongoose from "mongoose";
import { LABOUR_ID_PATTERN } from "../constants/labour.js";
import { MAX_MAAPS_PER_ENTRY, MAX_NOTE_LENGTH } from "../constants/maapvali.js";
import { businessDateField, createSchema, moneyField, softDeleteFields } from "../utils/schema.js";

// One Maapvali worker's maap work for one business day. At most ONE live entry per worker per date (partial unique
// index below); a voided entry frees the slot but stays in the database.
//
// What is stored: the maaps typed that day, the rate snapshot in force that day (ratePaise = rupees per 4 maaps, in paise)
// and the earnings worked out ONCE from those two (earningsPaise, rounded half up). Because the rate is a snapshot on the
// entry, a later rate change never recalculates old work. Payments live elsewhere and never touch this collection.

const snapshotSchema = new mongoose.Schema(
  {
    date: { type: String },
    numberOfMaaps: { type: Number },
    note: { type: String },
    earningsPaise: { type: Number },
  },
  { _id: false }
);

// Append-only: what an entry looked like before each correction, who changed it, when and why.
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

const maapEntrySchema = createSchema({
  labourId: { type: String, required: true, immutable: true, match: LABOUR_ID_PATTERN, ref: "Labour" },
  date: businessDateField({ required: true }),
  numberOfMaaps: {
    type: Number,
    required: true,
    min: [0, "numberOfMaaps cannot be negative"],
    max: [MAX_MAAPS_PER_ENTRY, `numberOfMaaps cannot be more than ${MAX_MAAPS_PER_ENTRY}`],
    validate: { validator: Number.isInteger, message: "numberOfMaaps must be a whole number" },
  },
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

// The duplicate rule, enforced by the database: one LIVE entry per worker per day.
maapEntrySchema.index({ labourId: 1, date: 1 }, { unique: true, partialFilterExpression: { isDeleted: false } });
// One day for everyone, and date-range history.
maapEntrySchema.index({ date: 1, labourId: 1 });
maapEntrySchema.index({ labourId: 1, date: -1 });

export default mongoose.models.MaapEntry || mongoose.model("MaapEntry", maapEntrySchema);
