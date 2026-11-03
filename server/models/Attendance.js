import mongoose from "mongoose";
import { ATTENDANCE_STATUS_VALUES } from "../constants/attendance.js";
import { LABOUR_ID_PATTERN } from "../constants/labour.js";
import { businessDateField, createSchema } from "../utils/schema.js";

// One Bigari worker's status for one business day. Exactly ONE record per worker per date (unique index below).
// Saving a day again corrects the existing record; it never adds a second one.
// Records are never deleted. Every correction is appended to `history` (the status it replaced, who, when, why).
// Attendance holds no money and no payment data: earnings are worked out when read, from the rate history.

const correctionSchema = new mongoose.Schema(
  {
    from: { type: String, enum: ATTENDANCE_STATUS_VALUES, required: true },
    to: { type: String, enum: ATTENDANCE_STATUS_VALUES, required: true },
    at: { type: Date, required: true },
    by: { type: String, required: true },
    byId: { type: String, default: null },
    reason: { type: String, trim: true, maxlength: 200, default: null },
  },
  { _id: false }
);

const attendanceSchema = createSchema({
  labourId: { type: String, required: true, immutable: true, match: LABOUR_ID_PATTERN, ref: "Labour" },
  date: businessDateField({ required: true, immutable: true }),
  status: { type: String, enum: ATTENDANCE_STATUS_VALUES, required: true },
  revision: { type: Number, default: 1, min: 1 },
  history: { type: [correctionSchema], default: [] },
  createdBy: { type: String, default: null },
  updatedBy: { type: String, default: null },
});

// The duplicate rule, enforced by the database and not only by code.
attendanceSchema.index({ labourId: 1, date: 1 }, { unique: true });
// "Everyone on one day" and date-range reports.
attendanceSchema.index({ date: 1, labourId: 1 });

export default mongoose.models.Attendance || mongoose.model("Attendance", attendanceSchema);
