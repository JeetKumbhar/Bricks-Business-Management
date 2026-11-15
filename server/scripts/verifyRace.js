// Real-database race test for the Maapvali batch save. TEST DATABASE ONLY. Run by the owner, never automatically.
//
// What it proves: a competing correction that COMMITS after the batch read its rows but BEFORE the batch's revision-guarded write
// makes the batch answer HTTP 409 "Nothing was saved", leaves no other row of the batch behind, and keeps the rival's change.
// Cases R1 / R2 (rival) and R3 (control, no rival at all). See scripts/lib/raceHarness.js for the exact sequence and checks.
//
// It starts the real Express app IN THIS PROCESS on 127.0.0.1 (random port) and talks to it over HTTP, so it always uses the
// database named in MONGODB_URI. It never talks to a separately running backend.
//
// Run (Windows PowerShell, from the server folder; the TEST owner's password is typed hidden and never printed):
//   $env:OWNER_EMAIL = "testowner@example.com"
//   $env:OWNER_PASSWORD = [System.Net.NetworkCredential]::new("", (Read-Host "TEST owner password" -AsSecureString)).Password
//   node scripts\verifyRace.js --mode atlas --confirm-db <exact _test database name> --i-understand-this-writes-test-data
//   Remove-Item Env:OWNER_EMAIL, Env:OWNER_PASSWORD
// Optional: --dates 2026-11-12,2026-11-11,2026-11-10 (R1,R2,R3; three unused past dates).
//
// SAFETY (all checked BEFORE anything connects; the database, the application and the models are loaded only after they pass):
//   - --mode atlas is required (without it nothing runs; the mocked checks are a Vitest file and never connect)
//   - --i-understand-this-writes-test-data is required
//   - NODE_ENV=production is refused
//   - the database name in MONGODB_URI must END with "_test" (case-insensitive) AND equal --confirm-db
//   - after connecting, the live connection's database name must equal the confirmed name
//   - INDEX SAFETY: config/db.js sets Mongoose autoIndex = !isProduction when it is imported, so autoIndex and autoCreate are
//     forced to false AFTER that import, and checked again right before the app and the models are imported. If either is not
//     false the run refuses (exit 2). This script never builds an index and never creates a collection.
//   - PREFLIGHT, read-only, before the FIRST write: both fixture workers (by mobile and by name; type, status, rate) and ALL three
//     case dates for BOTH workers (live and deleted entries). Any collision or used date refuses the whole run, nothing written.
//   - only the database NAME is printed, never the connection string, the password or a cookie
//
// EVERY WRITE this run can make (TEST database only; it never updates or deletes anything that already exists):
//   users           the TEST owner's lastLoginAt, on a successful login (the account you give in OWNER_EMAIL; it must exist in the
//                   TEST database named above, nothing else is written to it)
//   counters        the labour id counter is incremented once for each NEW worker created (a worker that fails to save can still
//                   consume a number: harmless gaps)
//   labours         up to two NEW workers "ZZ RACE X" and "ZZ RACE Y" (only if absent; existing ones are only read)
//   labourratehistories  one NEW "Initial rate" row (100 per 4 maaps) for each new worker, saved in the same transaction
//   maapentries     NEW entries on the three case dates: a seed for X on each, the rival correction (updates X's own seeded entry
//                   in R1/R2), the batch's rows (R3 updates X's seeded entry and creates Y's; R1/R2 are rolled back)
// NOT written: no index, no collection, no other user data, no deletes, no settings. Reads use the application's own queries plus
// independent read-only checks (majority read concern for the entries).
// Exit codes: 0 PASS, 1 FAIL, 2 refused, 3 inconclusive.

import dotenv from "dotenv";
import http from "node:http";
import { EXIT_CODES, applyIndexSafety, checkAtlasGuards, formatReport, indexSafetyProblem, runRace, shutdownServer } from "./lib/raceHarness.js";

dotenv.config({ quiet: true });

const guards = checkAtlasGuards({ argv: process.argv.slice(2), env: process.env });
if (!guards.ok) {
  console.error(guards.problem);
  process.exit(EXIT_CODES.REFUSED);
}
console.log(`Target database: ${guards.dbName} (confirmed TEST)`);

// ---- Only now is anything loaded that can connect ----
const { default: mongoose } = await import("mongoose");
const { connectDB, disconnectDB } = await import("../config/db.js"); // sets autoIndex = !isProduction at import: corrected right below
const unsafeBeforeConnect = applyIndexSafety(mongoose); // AFTER the db.js import, BEFORE the app or any model is imported
if (unsafeBeforeConnect) {
  console.error(unsafeBeforeConnect);
  process.exit(EXIT_CODES.REFUSED);
}

let server;
let exitCode = EXIT_CODES.INCONCLUSIVE;
try {
  await connectDB(process.env.MONGODB_URI);
  if (mongoose.connection.name !== guards.dbName) {
    console.error(`Refusing: the live connection is to "${mongoose.connection.name}", not "${guards.dbName}". Nothing was written.`);
    exitCode = EXIT_CODES.REFUSED;
  } else if (indexSafetyProblem(mongoose)) {
    console.error(indexSafetyProblem(mongoose)); // checked again immediately before the models load
    exitCode = EXIT_CODES.REFUSED;
  } else {
    const { default: app } = await import("../app.js");
    const { default: MaapEntry } = await import("../models/MaapEntry.js");
    const { default: Labour } = await import("../models/Labour.js");
    const { default: LabourRateHistory } = await import("../models/LabourRateHistory.js");
    const { todayBusinessDate } = await import("../utils/dates.js");

    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${server.address().port}`;

    let cookie = "";
    const call = async (method, path, body) => {
      const response = await fetch(`${base}${path}`, {
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
    if (login.status !== 200) {
      console.error(`Refusing: the TEST owner login returned HTTP ${login.status}. Nothing else was written.`);
      exitCode = EXIT_CODES.REFUSED;
    } else {
      cookie = login.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
      const deps = {
        api: async (method, path, body) => {
          const { status, body: parsed } = await call(method, path, body);
          return { status, body: parsed };
        },
        MaapEntry,
        readLabours: (filter) => Labour.collection.find(filter).toArray(),
        readRates: (labourId) => LabourRateHistory.collection.find({ labourId }).toArray(),
        // independent, majority-read look at the stored documents (bypasses the observed model entirely)
        readEntries: ({ labourId, date }) => MaapEntry.collection.find({ labourId, date }, { readConcern: { level: "majority" } }).toArray(),
        today: () => todayBusinessDate(),
        log: (line) => console.log(line),
      };
      const result = await runRace(deps, { dates: guards.dates });
      for (const line of formatReport(result)) console.log(line);
      exitCode = EXIT_CODES[result.verdict] ?? EXIT_CODES.INCONCLUSIVE;
    }
  }
} catch (err) {
  // Never print the connection string: only the error's name and a short message
  console.error(`Stopped: ${err?.name ?? "Error"}: ${String(err?.message ?? err).replace(/mongodb(?:\+srv)?:\/\/\S+/gi, "[connection string hidden]")}`);
  exitCode = EXIT_CODES.INCONCLUSIVE;
} finally {
  // Runs on success, failure, timeout and any exception: stop listening AND destroy active connections (a stuck request must not
  // keep the process waiting), then close the database connection. No database cleanup operation is performed: nothing is deleted.
  await shutdownServer(server);
  await disconnectDB().catch(() => {});
}
process.exit(exitCode);
