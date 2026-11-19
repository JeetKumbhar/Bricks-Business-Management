// Phase 1C: READ-ONLY historical-data census. TEST DATABASE ONLY. Run by the owner; never run automatically.
//   node scripts/censusHistorical.js --read-only-census --confirm-db aayush_carting_test --confirm-host aayush-carting.7xmegwh.mongodb.net
// It never writes: only native find() calls. It refuses unless MONGODB_URI names the database aayush_carting_test on the confirmed
// cluster, and checks the live connection again after connecting. autoIndex / autoCreate are forced OFF so loading models creates nothing.
// Exit codes: 0 no issues, 1 issues found (report only), 2 refused, 3 inconclusive.
import dotenv from "dotenv";
import { EXIT, checkCensusGuards, formatCensus, runCensus } from "./lib/census.js";
import { applyIndexSafety, indexSafetyProblem, liveConnectionProblem } from "./lib/patlavaleHarness.js";

dotenv.config({ quiet: true });

const guards = checkCensusGuards({ argv: process.argv.slice(2), env: process.env });
if (!guards.ok) {
  console.error(guards.problem);
  process.exit(EXIT.REFUSED);
}
console.log(`Target database: ${guards.dbName}; confirmed cluster: ${guards.host}`);

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
    const models = {
      labours: (await import("../models/Labour.js")).default,
      rates: (await import("../models/LabourRateHistory.js")).default,
      attendance: (await import("../models/Attendance.js")).default,
      maap: (await import("../models/MaapEntry.js")).default,
      production: (await import("../models/ProductionEntry.js")).default,
      payments: (await import("../models/Payment.js")).default,
      seasons: (await import("../models/Season.js")).default,
      counters: (await import("../models/Counter.js")).default,
    };
    const read = (name, filter) => models[name].collection.find(filter).toArray(); // native read, no hooks, no writes
    const result = await runCensus(read);
    for (const line of formatCensus(result, guards)) console.log(line);
    exitCode = result.issues === 0 ? EXIT.OK : EXIT.ISSUES;
  }
} catch (err) {
  console.error(`Stopped: ${err?.name ?? "Error"}: ${String(err?.message ?? err).replace(/mongodb(?:\+srv)?:\/\/\S+/gi, "[connection string hidden]")}`);
} finally {
  await disconnectDB().catch(() => {});
}
process.exit(exitCode);
