// Creates the indexes the models declare (unique registration numbers, one Pheera number per truck and day, one live
// payment per request id, ...). In production Mongoose does NOT build indexes on start (autoIndex is off), so run this once
// after deploying, and again after any release that adds or changes an index:
//
//   npm run sync-indexes
//
// It makes the database match the models: missing indexes are created, and indexes that no model declares are dropped.
// It reads MONGODB_URI from the environment and never prints it.
import mongoose from "mongoose";
import { connectDB, describeTarget, disconnectDB } from "../config/db.js";
import { env } from "../config/env.js";
import "../models/Attendance.js";
import "../models/Counter.js";
import "../models/Labour.js";
import "../models/LabourRateHistory.js";
import "../models/MaapEntry.js";
import "../models/Payment.js";
import "../models/ProductionEntry.js";
import "../models/Season.js";
import "../models/Truck.js";
import "../models/TruckStatusHistory.js";
import "../models/TruckTrip.js";
import "../models/User.js";

try {
  await connectDB();
  console.log(`Syncing indexes on ${describeTarget(env.mongodbUri)}`);
  for (const [name, model] of Object.entries(mongoose.models)) {
    const dropped = await model.syncIndexes();
    console.log(`${name}: ok${dropped.length ? ` (dropped ${dropped.join(", ")})` : ""}`);
  }
} catch (err) {
  console.error(`Index sync failed: ${err.message}`);
  process.exitCode = 1;
} finally {
  await disconnectDB();
}
