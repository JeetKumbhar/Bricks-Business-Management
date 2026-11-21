import mongoose from "mongoose";
import { LABOUR_ID_PATTERN, LABOUR_STATUS, LABOUR_STATUS_VALUES, LABOUR_TYPES, LABOUR_TYPE_VALUES, MAX_TEAM_MEMBERS, MOBILE_PATTERN } from "../constants/labour.js";
import { businessDateField, createSchema } from "../utils/schema.js";

// One salary account: an individual Bigari or Maapvali worker, or a whole Patlavale team / family.
// The id is the frontend's own "L-001" string, so every later collection can reference it as `labourId` unchanged.
// The rate is NOT stored here: it lives in LabourRateHistory (one row per change), so old earnings can be priced correctly.
const memberSchema = new mongoose.Schema(
  { name: { type: String, required: true, trim: true, minlength: 1, maxlength: 60 }, relation: { type: String, trim: true, maxlength: 30, default: undefined } },
  { _id: false }
);

// Append-only log of status changes (who deactivated or reactivated, when, why). Never edited or removed.
const statusChangeSchema = new mongoose.Schema(
  {
    status: { type: String, enum: LABOUR_STATUS_VALUES, required: true },
    at: { type: Date, required: true },
    by: { type: String, required: true },
    reason: { type: String, trim: true, maxlength: 200, default: null },
  },
  { _id: false }
);

const labourSchema = createSchema({
  _id: { type: String, match: LABOUR_ID_PATTERN },
  labourType: { type: String, enum: LABOUR_TYPE_VALUES, required: true, immutable: true },
  name: { type: String, required: true, trim: true, minlength: 2, maxlength: 60 },
  // Optional and NOT unique: a worker may have no phone, and family members or one person registered in two categories may share a number.
  // "No number" is always stored as null (an empty or blank value is turned into null), never as an empty string.
  mobile: { type: String, default: null, trim: true, set: (v) => (typeof v === "string" && v.trim() === "" ? null : v), match: [MOBILE_PATTERN, "mobile must be a 10-digit Indian mobile number"] },
  village: { type: String, required: true, trim: true, minlength: 1, maxlength: 60 },
  joiningDate: businessDateField({ required: true }),
  status: { type: String, enum: LABOUR_STATUS_VALUES, default: LABOUR_STATUS.ACTIVE },
  // Patlavale only. Reference details; members are never salary recipients.
  members: {
    type: [memberSchema],
    default: undefined,
    validate: [
      {
        validator(value) {
          return !value || value.length === 0 || this.labourType === LABOUR_TYPES.PATLAVALE;
        },
        message: "members are only allowed for a Patlavale team",
      },
      { validator: (value) => !value || value.length <= MAX_TEAM_MEMBERS, message: `a team can list at most ${MAX_TEAM_MEMBERS} members` },
    ],
  },
  statusHistory: { type: [statusChangeSchema], default: [] },
  createdBy: { type: String, default: null },
});

// No index on mobile: it is not an identity (the worker id is). An older database may still hold a unique `mobile_1` index; see the release notes.
labourSchema.index({ labourType: 1, status: 1 });
labourSchema.index({ joiningDate: 1 });

export default mongoose.models.Labour || mongoose.model("Labour", labourSchema);
