// Phase 1C Stage 4: real-MongoDB verification, ONE PHASE PER RUN. TEST DATABASE ONLY. Run by the owner after explicit approval.
//   node scripts/verifyPhase1C.js --phase precheck --confirm-db aayush_carting_test --confirm-host aayush-carting.7xmegwh.mongodb.net
//   node scripts/verifyPhase1C.js --phase d1|d2|p6|p3 --i-understand-this-writes-test-data --confirm-db ... --confirm-host ... [phase flags]
// Phase flags: p3 needs --accept-permanent-numbering-lock (optional --accept-numbering-race); d2 may add --allow-direct-fixture-insert.
// A write phase refuses to start if an earlier run of it left fixtures behind; --allow-rerun overrides that knowingly.
// Every record is printed the moment it is created, so an interrupted run still shows what it left.
// It refuses unless MONGODB_URI names aayush_carting_test on the confirmed cluster (checked before connecting and again on the live
// connection). autoIndex / autoCreate are forced OFF. It never deletes, drops, migrates or touches indexes. Exit: 0 pass, 1 fail,
// 2 refused, 3 inconclusive (also when any test was skipped).
import dotenv from "dotenv";
import { EXIT, FIXTURE, checkGuards, formatReport, runPhase } from "./lib/phase1cHarness.js";
import { applyIndexSafety, indexSafetyProblem, liveConnectionProblem } from "./lib/patlavaleHarness.js";

dotenv.config({ quiet: true });

const { todayBusinessDate } = await import("../utils/dates.js");
const today = todayBusinessDate();
const guards = checkGuards({ argv: process.argv.slice(2), env: process.env, today });
if (!guards.ok) {
  console.error(guards.problem);
  process.exit(EXIT.REFUSED);
}
console.log(`Phase ${guards.phase}; target database ${guards.dbName}; confirmed cluster ${guards.host}; ${guards.writes ? "WRITES test records" : "read-only"}`);

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
      settings: (await import("../models/InvoiceSettings.js")).default,
      bills: (await import("../models/Bill.js")).default,
    };
    const { runInTransaction } = await import("../utils/transaction.js");
    const { SETTINGS_ID } = await import("../constants/bill.js");
    const services = {
      labour: await import("../services/labour.service.js"),
      attendance: await import("../services/attendance.service.js"),
      maap: await import("../services/maapEntry.service.js"),
      payment: await import("../services/payment.service.js"),
      season: await import("../services/season.service.js"),
      production: await import("../services/productionEntry.service.js"),
      bill: await import("../services/bill.service.js"),
      invoiceSettings: await import("../services/invoiceSettings.service.js"),
      salary: await import("../services/salary.service.js"),
      balance: await import("../services/balance.service.js"),
    };
    const runNumber = Math.floor(Math.random() * 10000);
    const deps = {
      services,
      read: (name, filter) => m[name].collection.find(filter).toArray(), // native read: no hooks, no writes
      insertLegacyLabour: (doc) => {
        const now = new Date();
        return m.labours.collection.insertOne({ ...doc, statusHistory: [{ status: "ACTIVE", at: now, by: `${FIXTURE.prefix}`, reason: "Created (legacy-shaped fixture, no rate row)" }], createdAt: now, updatedAt: now });
      },
      probeTransaction: () => runInTransaction((session) => m.labours.findOne({}, "_id", { session }).lean(), { required: true }),
      onRecord: (r) => console.log(`  + created ${r.collection}: ${r.id} - ${r.note}`),
      toObjectId: (hex) => new mongoose.Types.ObjectId(hex), // native reads do not cast; ObjectId-backed _id values must be real ObjectIds
      today, runNumber, runId: `R${runNumber}`, settingsId: SETTINGS_ID,
    };
    const run = await runPhase(guards.phase, deps, { windowStart: guards.windowStart, flags: guards.flags });
    for (const line of formatReport(run, guards)) console.log(line);
    exitCode = run.verdict;
  }
} catch (err) {
  console.error(`Stopped: ${err?.name ?? "Error"}: ${String(err?.message ?? err).replace(/mongodb(?:\+srv)?:\/\/\S+/gi, "[connection string hidden]")}`);
} finally {
  await disconnectDB().catch(() => {});
}
process.exit(exitCode);
