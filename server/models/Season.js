import mongoose from "mongoose";
import { MAX_SEASON_NAME_LENGTH, SEASON_STATUS, SEASON_STATUS_VALUES } from "../constants/production.js";
import { isValidBusinessDate } from "../utils/dates.js";
import { businessDateField, createSchema } from "../utils/schema.js";

// A production season: a named date range the owner defines. A work date belongs to the season whose range covers it
// (the service refuses overlapping ranges, so there is at most one). endDate null = still running.
// A CLOSED season is read-only for production: nothing can be saved, corrected or deleted in it until it is reopened.
const seasonSchema = createSchema({
  name: { type: String, required: true, trim: true, maxlength: MAX_SEASON_NAME_LENGTH },
  startDate: businessDateField({ required: true }),
  endDate: businessDateField({ default: null, validate: { validator: (v) => v === null || isValidBusinessDate(v), message: "endDate must be a valid date in YYYY-MM-DD form" } }),
  status: { type: String, enum: SEASON_STATUS_VALUES, default: SEASON_STATUS.OPEN },
  revision: { type: Number, default: 1, min: 1 },
  createdBy: { type: String, default: null },
  updatedBy: { type: String, default: null },
});

seasonSchema.index({ name: 1 }, { unique: true });
seasonSchema.index({ startDate: 1 });

export default mongoose.models.Season || mongoose.model("Season", seasonSchema);
