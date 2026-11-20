// Real-database verification of Patlavale production (P1-P5 + transaction/rollback T). TEST DATABASE ONLY.
// Run by the owner, only after explicit approval, never automatically. See scripts/lib/patlavaleHarness.js for every check.
//
// It starts the real Express app IN THIS PROCESS on 127.0.0.1 (random port) and talks to it over HTTP, so it always uses the database
// named in MONGODB_URI. It never talks to a separately running backend.
//
// Run (Windows PowerShell, from the server folder; the TEST owner's password is typed hidden and never printed):
//   $env:OWNER_EMAIL = "testowner@example.com"
//   $env:OWNER_PASSWORD = [System.Net.NetworkCredential]::new("", (Read-Host "TEST owner password" -AsSecureString)).Password
//   node scripts\verifyPatlavale.js --mode atlas --confirm-db aayush_carting_test --confirm-host aayush-carting.7xmegwh.mongodb.net --i-understand-this-writes-test-data
//   Remove-Item Env:OWNER_EMAIL, Env:OWNER_PASSWORD
// Optional: --window-start 2025-03-01 (the first day of an 81-day PAST window with no seasons and no production entries).
// Mocked check (never connects): npx vitest run tests/patlavaleHarness.test.js        (--mode mocked just prints this hint)
//
// EXECUTION ORDER (nothing is written until step 7):
//   1. guards on the command line and environment (refuse = exit 2, nothing loaded, nothing connected)
//   2. load the database module, then force Mongoose autoIndex / autoCreate OFF (config/db.js turns autoIndex ON when it is imported
//      outside production, so this comes after that import and before any model); refuse if either is not false
//   3. connect (reads only; connecting writes nothing)
//   4. check that the LIVE connection's database name is aayush_carting_test AND its host belongs to the confirmed cluster
//      (aayush-carting.7xmegwh.mongodb.net); check the index settings again
//   5. load the models (nothing else: no app, no HTTP server yet)
//   6. READ-ONLY PREFLIGHT before the owner logs in: planned names, mobile numbers, season names, season overlap with the window, and
//      ALL production entries (live and deleted) inside the window. Any hit refuses the whole run (exit 2): no login, no write
//   7. only after a clean preflight: load the app, start the in-process HTTP server and sign the TEST owner in (the FIRST write:
//      lastLoginAt). A failed login refuses the run
//   8. create the fixtures (2 seasons, 5 Patlavale teams, 1 Maapvali worker), then run P1, P2, P3, P4, P5 and T, reading every result
//      back from MongoDB (majority read concern)
//   9. always, on every path: destroy active connections, close the listener, close the database connection. NO cleanup: every
//      fixture is preserved and its id is printed
//
// SAFETY:
//   - --mode atlas, --i-understand-this-writes-test-data, --confirm-db aayush_carting_test AND --confirm-host <cluster> are all required
//   - NODE_ENV=production is refused
//   - the database name in MONGODB_URI must be exactly aayush_carting_test; every host in MONGODB_URI must be the confirmed cluster
//     (or one of its shard hosts); the live connection is checked again after connecting
//   - only the database NAME and the cluster HOST are printed, never the connection string, the password or a cookie
//
// EVERY WRITE this run can make (TEST database only, all AFTER the preflight in step 6; it never updates or deletes anything that
// already existed):
//   users                 the TEST owner's lastLoginAt, on a successful login
//   counters              the labour id counter, once per new worker (a failed worker can still consume a number: harmless gap)
//   labours               6 NEW workers: "ZZ PATLAVALE VERIFY TEAM A".."E" (Patlavale) and "ZZ PATLAVALE VERIFY MAAPVALI"
//   labourratehistories   one "Initial rate" row per new worker, plus ONE rate change (to 800) for TEAM C
//   seasons               2 NEW seasons "ZZ PATLAVALE VERIFY SEASON 1/2"; SEASON 2 is then set CLOSED (our own season)
//   productionentries     NEW entries for the new teams on dates inside the window; corrections and soft deletes ONLY of entries
//                         this run created. Nothing is hard-deleted
//   payments              ONE salary payment (123.45) to TEAM E, to prove payments do not touch production totals
// NOT written: no index, no collection, no other user data, no deletes, no settings. Reads use independent native queries.
// Exit codes: 0 PASS, 1 FAIL, 2 refused, 3 inconclusive.

import dotenv from "dotenv";
import http from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { EXIT_CODES, applyIndexSafety, checkAtlasGuards, formatReport, indexSafetyProblem, liveConnectionProblem, runGuarded, shutdownServer } from "./lib/patlavaleHarness.js";

dotenv.config({ quiet: true });

if (process.argv.includes("--mode") && process.argv[process.argv.indexOf("--mode") + 1] === "mocked") {
  console.log("Mocked mode never connects and is a Vitest file: npx vitest run tests/patlavaleHarness.test.js");
  process.exit(EXIT_CODES.PASS);
}

const guards = checkAtlasGuards({ argv: process.argv.slice(2), env: process.env });
if (!guards.ok) {
  console.error(guards.problem);
  process.exit(EXIT_CODES.REFUSED);
}
console.log(`Target database: ${guards.dbName}; confirmed cluster: ${guards.host}`);

// ---- Only now is anything loaded that can connect ----
const { default: mongoose } = await import("mongoose");
const { connectDB, disconnectDB } = await import("../config/db.js"); // sets autoIndex = !isProduction at import: corrected right below
const unsafeBeforeConnect = applyIndexSafety(mongoose); // AFTER the db.js import, BEFORE the app or any model is imported
if (unsafeBeforeConnect) {
  console.error(unsafeBeforeConnect);
  process.exit(EXIT_CODES.REFUSED);
}

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let server;
let exitCode = EXIT_CODES.INCONCLUSIVE;
try {
  await connectDB(process.env.MONGODB_URI);
  const problem = liveConnectionProblem({ liveName: mongoose.connection.name, liveHost: mongoose.connection.host }) ?? indexSafetyProblem(mongoose);
  if (problem) {
    console.error(problem);
    exitCode = EXIT_CODES.REFUSED;
  } else {
    // Step 5: models only (no app, no HTTP server, no login yet)
    const { default: ProductionEntry } = await import("../models/ProductionEntry.js");
    const { default: Labour } = await import("../models/Labour.js");
    const { default: LabourRateHistory } = await import("../models/LabourRateHistory.js");
    const { default: Season } = await import("../models/Season.js");
    const { default: Payment } = await import("../models/Payment.js");
    const { todayBusinessDate } = await import("../utils/dates.js");
    const money = await import("../utils/money.js");

    // Independent READ-ONLY functions: they bypass the application entirely, so they need no login and write nothing.
    const majority = { readConcern: { level: "majority" } };
    const readDeps = {
      readLabours: (filter) => Labour.collection.find(filter).toArray(),
      readSeasons: () => Season.collection.find({}).toArray(),
      readRates: (labourId) => LabourRateHistory.collection.find({ labourId }).toArray(),
      readProduction: (filter) => ProductionEntry.collection.find(filter, majority).toArray(),
      readPayments: (filter) => Payment.collection.find(filter, majority).toArray(),
      readSource: (relative) => readFile(path.join(serverDir, relative), "utf8"),
      money: { rupeesToPaise: money.rupeesToPaise, earningsPaiseForMaaps: money.earningsPaiseForMaaps },
      today: () => todayBusinessDate(),
      log: (line) => console.log(line),
    };

    // Step 7, called by runGuarded ONLY after the read-only preflight (step 6) approved the run
    const startAndLogin = async () => {
      const { default: app } = await import("../app.js");
      server = http.createServer(app);
      await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
      const base = `http://127.0.0.1:${server.address().port}`;
      let cookie = "";
      const call = async (method, urlPath, body) => {
        const response = await fetch(`${base}${urlPath}`, {
          method: method.toUpperCase(),
          headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        const text = await response.text();
        let parsed = null;
        try {
          parsed = text ? JSON.parse(text) : null;
        } catch {
          parsed = null;
        }
        return { status: response.status, body: parsed, headers: response.headers };
      };
      const login = await call("post", "/api/auth/login", { email: process.env.OWNER_EMAIL, password: process.env.OWNER_PASSWORD });
      if (login.status !== 200) return { refused: `the TEST owner login returned HTTP ${login.status}. Nothing else was written.` };
      cookie = login.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
      return {
        ...readDeps,
        ProductionEntry,
        // Closes ONLY this run's own test season, through the internal service (no settlement record is written for a test season).
        closeSeason: async (id) => {
          const { updateSeason } = await import("../services/season.service.js");
          await updateSeason(id, { status: "CLOSED" }, { id: null, name: "Patlavale test run" });
          return { status: 200, body: null };
        },
        api: async (method, urlPath, body) => {
          const { status, body: parsed } = await call(method, urlPath, body);
          return { status, body: parsed };
        },
      };
    };

    const result = await runGuarded({ readDeps, startAndLogin, opts: { base: guards.base, mode: "ATLAS" } });
    for (const line of formatReport(result, { dbName: guards.dbName, host: guards.host })) console.log(line);
    exitCode = EXIT_CODES[result.verdict] ?? EXIT_CODES.INCONCLUSIVE;
  }
} catch (err) {
  // Never print the connection string: only the error's name and a short message
  console.error(`Stopped: ${err?.name ?? "Error"}: ${String(err?.message ?? err).replace(/mongodb(?:\+srv)?:\/\/\S+/gi, "[connection string hidden]")}`);
  exitCode = EXIT_CODES.INCONCLUSIVE;
} finally {
  await shutdownServer(server);
  await disconnectDB().catch(() => {});
}
process.exit(exitCode);
