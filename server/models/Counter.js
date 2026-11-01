import mongoose from "mongoose";

// One document per named sequence. Incremented atomically, so two requests can never receive the same number and a
// number is never handed out twice (labour ids L-001, L-002, ... are never reused, even after a failed save).
const counterSchema = new mongoose.Schema({ _id: { type: String, required: true }, seq: { type: Number, default: 0 } }, { versionKey: false });

export default mongoose.models.Counter || mongoose.model("Counter", counterSchema);
