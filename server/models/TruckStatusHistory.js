import mongoose from "mongoose";
import { HISTORY_KIND_VALUES, MAX_NOTE, STOP_REASON_VALUES, TRUCK_STATUS_VALUES } from "../constants/truck.js";
import { LABOUR_ID_PATTERN } from "../constants/labour.js";
import { createSchema } from "../utils/schema.js";

// Append-only log of what happened to a truck: it was added, its status changed, or its driver changed. Rows are only ever
// added, never edited or removed, so the history survives the truck going back to Working. `changedAt` is a UTC instant.
const historySchema = createSchema({
  truckId: { type: mongoose.Schema.Types.ObjectId, ref: "Truck", required: true, immutable: true },
  kind: { type: String, enum: HISTORY_KIND_VALUES, required: true },
  from: { type: String, enum: TRUCK_STATUS_VALUES, default: null },
  to: { type: String, enum: TRUCK_STATUS_VALUES, default: null },
  reason: { type: String, enum: STOP_REASON_VALUES, default: null },
  note: { type: String, trim: true, maxlength: MAX_NOTE, default: "" },
  previousDriverId: { type: String, match: LABOUR_ID_PATTERN, default: null },
  newDriverId: { type: String, match: LABOUR_ID_PATTERN, default: null },
  changedBy: { type: String, default: null }, // the person's name
  changedById: { type: String, default: null },
  changedAt: { type: Date, required: true },
});

historySchema.index({ truckId: 1, changedAt: -1 });

export default mongoose.models.TruckStatusHistory || mongoose.model("TruckStatusHistory", historySchema);
