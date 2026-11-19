// Phase 1C: READ-ONLY check of the fixtures left by an earlier D1 run. TEST DATABASE ONLY. Run by the owner after explicit approval.
//   node scripts/verifyD1Fixtures.js --confirm-db aayush_carting_test --confirm-host aayush-carting.7xmegwh.mongodb.net
// Uses only collection.find(). No write flag exists. autoIndex / autoCreate are forced OFF. Exit: 0 all checks pass, 1 any check failed,
// 2 refused, 3 skipped checks or an error. It never prints mobile numbers or the connection string.
import dotenv from "dotenv";
import { EXIT, checkVerifyGuards, formatVerifyReport, makeReader, runVerification, verdictOf } from "./lib/d1VerifyLib.js";
import { applyIndexSafety, indexSafetyProblem, liveConnectionProblem } from "./lib/patlavaleHarness.js";

dotenv.config({ quiet: true });

const guards = checkVerifyGuards({ argv: process.argv.slice(2), env: process.env });
if (!guards.ok) {
  console.error(guards.problem);
  process.exit(EXIT.REFUSED);
}
console.log(`Read-only D1 verification; target database ${guards.dbName}; confirmed cluster ${guards.host}`);

const { default: mongoose } = await import("mongoose");
const { connectDB, disconnectDB } = await import("../config/db.js");
const unsafe = applyIndexSafety(mongoose);
if (unsafe) {
  console.error(unsafe);
  process.exit(EXIT.REFUSED);
}

let exitCode = EXIT.INCONCLUSIVE;
try {
  await connectDB(process.env.MONGODB_URI);
  const problem = liveConnectionProblem({ liveName: mongoose.connection.name, liveHost: mongoose.connection.host }) ?? indexSafetyProblem(mongoose);
  if (problem) {
    console.error(problem);
    exitCode = EXIT.REFUSED;
  } else {
    const m = {
      labours: (await import("../models/Labour.js")).default,
      rates: (await import("../models/LabourRateHistory.js")).default,
      attendance: (await import("../models/Attendance.js")).default,
      maap: (await import("../models/MaapEntry.js")).default,
      production: (await import("../models/ProductionEntry.js")).default,
      payments: (await import("../models/Payment.js")).default,
      seasons: (await import("../models/Season.js")).default,
      counters: (await import("../models/Counter.js")).default,
    };
    const { read, reads } = makeReader((name, filter) => m[name].collection.find(filter).toArray(), (hex) => new mongoose.Types.ObjectId(hex));
    const { results } = await runVerification(read, { windowStart: guards.windowStart });
    for (const line of formatVerifyReport({ results, reads }, guards)) console.log(line);
    exitCode = verdictOf(results);
  }
} catch (err) {
  console.error(`Stopped: ${err?.name ?? "Error"}: ${String(err?.message ?? err).replace(/mongodb(?:\+srv)?:\/\/\S+/gi, "[connection string hidden]")}`);
} finally {
  await disconnectDB().catch(() => {});
}
process.exit(exitCode);
