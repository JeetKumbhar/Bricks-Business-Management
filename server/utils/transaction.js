import mongoose from "mongoose";

// Runs `work(session)` as ONE MongoDB transaction: every write inside it is saved together or none is. Pass `{ session }`
// to each model call inside. The work may be run again if MongoDB reports a transient error, so it must read what it needs
// inside the callback and must not change anything outside the database.
//
// Atlas (and any replica set) supports transactions. A plain standalone MongoDB (some local dev installs) does not: there
// the work runs without a transaction (session is null) and a failure part-way can leave partial data. Use Atlas or a local
// replica set to get the all-or-nothing guarantee.
const isUnsupported = (err) => err?.code === 20 || /Transaction numbers are only allowed on a replica set/i.test(err?.message ?? "");

export const runInTransaction = async (work) => {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await work(session);
    });
    return result;
  } catch (err) {
    if (isUnsupported(err)) return work(null);
    throw err;
  } finally {
    await session.endSession();
  }
};
