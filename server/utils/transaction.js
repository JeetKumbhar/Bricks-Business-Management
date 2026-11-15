import mongoose from "mongoose";
import ApiError from "./ApiError.js";

// Runs `work(session)` as ONE MongoDB transaction: every write inside it is saved together or none is. Pass `{ session }`
// to each model call inside. The work may be run again if MongoDB reports a transient error, so it must read what it needs
// inside the callback and must not change anything outside the database.
//
// Atlas (and any replica set) supports transactions. A plain standalone MongoDB (some local dev installs) does not: there
// the work runs without a transaction (session is null) and a failure part-way can leave partial data. Use Atlas or a local
// replica set to get the all-or-nothing guarantee.
const isUnsupported = (err) => err?.code === 20 || /Transaction numbers are only allowed on a replica set/i.test(err?.message ?? "");

//
// { required: true } is for operations that must NEVER be saved half-way (batch saves, creating a worker with the first rate).
// If the database cannot do transactions, nothing is written and the request fails with a clear 503; it never falls back to plain writes.
export const runInTransaction = async (work, { required = false } = {}) => {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await work(session);
    });
    return result;
  } catch (err) {
    if (isUnsupported(err)) {
      if (required) throw new ApiError(503, "This database does not support transactions, so this all-or-nothing save cannot run. Nothing was saved. Use MongoDB Atlas or a replica set.");
      return work(null);
    }
    throw err;
  } finally {
    await session.endSession();
  }
};
