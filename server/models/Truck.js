import mongoose from "mongoose";
import { LABOUR_ID_PATTERN } from "../constants/labour.js";
import { MAX_CAPACITY_TONNES, MAX_MODEL, MAX_NICKNAME, MAX_NOTE, MAX_TRUCK_NUMBER, STOP_REASON_VALUES, TRUCK_STATUS, TRUCK_STATUS_VALUES } from "../constants/truck.js";
import { createSchema } from "../utils/schema.js";

// An operational truck (the real vehicle). Trucks are never deleted: Pheera records and status history refer to them and must
// stay readable. This collection has nothing to do with the decorative 3D truck in the intro animation.
//
// truckNumber is the registration number (upper-case, spaces collapsed). truckKey is the same with only letters and digits, and is
// unique, so "MH-04-AB-1234", "mh 04 ab 1234" and "MH04AB1234" cannot all exist. Every status change is also kept in
// TruckStatusHistory; here only the CURRENT status lives (stopReason and statusNote clear when the truck is Working again).

const truckSchema = createSchema({
  truckNumber: { type: String, required: true, trim: true, maxlength: MAX_TRUCK_NUMBER },
  truckKey: { type: String, required: true, immutable: false, match: /^[A-Z0-9]{3,}$/ },
  nickname: { type: String, trim: true, maxlength: MAX_NICKNAME, default: "" },
  model: { type: String, trim: true, maxlength: MAX_MODEL, default: "" },
  capacity: { type: Number, min: [0, "capacity cannot be negative"], max: MAX_CAPACITY_TONNES, default: null }, // tonnes
  driverId: { type: String, match: LABOUR_ID_PATTERN, default: null, ref: "Labour" },
  status: { type: String, enum: TRUCK_STATUS_VALUES, default: TRUCK_STATUS.WORKING },
  statusSince: { type: Date, required: true },
  stopReason: {
    type: String,
    enum: STOP_REASON_VALUES,
    default: null,
    validate: {
      validator(value) {
        return this.status === TRUCK_STATUS.STOPPED ? Boolean(value) : !value; // required when Stopped, empty otherwise
      },
      message: "stopReason is required when the truck is Stopped, and only then",
    },
  },
  statusNote: { type: String, trim: true, maxlength: MAX_NOTE, default: "" },
  createdBy: { type: String, default: null },
  updatedBy: { type: String, default: null },
});

truckSchema.index({ truckKey: 1 }, { unique: true });
truckSchema.index({ status: 1, truckNumber: 1 });

export default mongoose.models.Truck || mongoose.model("Truck", truckSchema);
