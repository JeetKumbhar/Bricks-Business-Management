import { spawnSync } from "node:child_process";
import http from "node:http";
import { readFileSync } from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";
import mongoose from "mongoose";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

// MOCKED ONLY. This file never connects to a database: MONGODB_URI is emptied BEFORE anything loads (dotenv does not override an
// existing variable), mongoose.connect is replaced by a function that throws, ../config/db.js is mocked, and every model the services
// use is the in-memory fake. It tests the race harness (scripts/lib/raceHarness.js) and the guards of the Atlas runner.
vi.hoisted(() => {
  process.env.NODE_ENV = "test";
  process.env.BCRYPT_ROUNDS = "4";
  process.env.CLIENT_ORIGIN = "http://localhost:5173";
  process.env.JWT_SECRET = "unit-test-secret-that-is-long-enough-0123456789";
  process.env.MONGODB_URI = "";
});

const { db, makeAttendanceModel, makeCounterModel, makeLabourModel, makeMaapEntryModel, makeRateModel } = await import("./helpers/memoryDb.js");
const users = vi.hoisted(() => ({ list: [] }));
// Fake transaction: snapshot, run, and on failure roll back to the snapshot but KEEP what a rival committed outside the transaction.
// A transient error ("TransientTransactionError") re-runs the work, like session.withTransaction does.
const txn = vi.hoisted(() => ({ active: false, sessionOp: false, budget: 0, attempts: 0, outside: new Map() }));

const connectBlocked = vi.hoisted(() => vi.fn(() => { throw new Error("TEST SAFETY: a database connection was attempted in a mocked test"); }));
vi.mock("../config/db.js", () => ({ getDbStatus: async () => ({ status: "connected", name: "test" }), connectDB: connectBlocked, disconnectDB: async () => {} }));
vi.mock("../models/User.js", () => ({
  default: { findById: (id) => ({ lean: async () => users.list.find((u) => String(u._id) === String(id)) ?? null }) },
}));
vi.mock("../models/Counter.js", () => ({ default: makeCounterModel() }));
vi.mock("../utils/transaction.js", () => ({
  runInTransaction: async (work) => {
    for (let attempt = 1; attempt <= 8; attempt += 1) {
      txn.attempts += 1;
      const snapshot = new Map([...db.maap].map(([k, v]) => [k, structuredClone(v)]));
      txn.active = true;
      txn.sessionOp = false;
      txn.outside = new Map();
      try {
        return await work({ fake: "session" });
      } catch (err) {
        db.maap.clear();
        for (const [k, v] of snapshot) db.maap.set(k, v);
        for (const [k, v] of txn.outside) db.maap.set(k, structuredClone(v)); // the rival's committed write survives our rollback
        if (!(err?.errorLabels ?? []).includes("TransientTransactionError")) throw err;
      } finally {
        txn.active = false;
      }
    }
    throw new Error("too many transient retries");
  },
}));
vi.mock("../models/Labour.js", async (importOriginal) => ({ default: makeLabourModel((await importOriginal()).default) }));
vi.mock("../models/LabourRateHistory.js", async (importOriginal) => ({ default: makeRateModel((await importOriginal()).default) }));
vi.mock("../models/Attendance.js", () => ({ default: makeAttendanceModel() }));
vi.mock("../models/MaapEntry.js", () => ({ default: makeMaapEntryModel() }));

const connectSpy = vi.spyOn(mongoose, "connect").mockImplementation(connectBlocked);
const createConnectionSpy = vi.spyOn(mongoose, "createConnection").mockImplementation(connectBlocked);

const { createApp } = await import("../app.js");
const { env } = await import("../config/env.js");
const { signAccessToken } = await import("../services/auth.service.js");
const { addDays, todayBusinessDate } = await import("../utils/dates.js");
const { correctionSchema, saveDaySchema } = await import("../validators/maapEntry.validators.js");
const FakeMaapEntry = (await import("../models/MaapEntry.js")).default;
const harness = await import("../scripts/lib/raceHarness.js");
const { AMOUNTS, CASES, FIXTURE, applyIndexSafety, bodies, checkAtlasGuards, indexSafetyProblem, parseDbName, preflight, runCase, runRace, shutdownServer } = harness;

// Emulates MongoDB's behaviour for a write inside a transaction whose snapshot predates a committed rival write: a transient
// WriteConflict (the transaction is retried). The very first operation of an attempt takes its snapshot afterwards, so it simply
// sees the new revision (no conflict). `txn.budget` = how many conflicts to raise in total.
const baseUpdateOne = FakeMaapEntry.updateOne;
const emulatedUpdateOne = async (filter, update, options = {}) => {
  if (options.session) {
    const first = !txn.sessionOp;
    txn.sessionOp = true;
    if (!first && filter?._id !== undefined && filter.revision !== undefined && txn.budget > 0) {
      const stored = db.maap.get(String(filter._id));
      if (stored && stored.revision !== filter.revision) {
        txn.budget -= 1;
        throw Object.assign(new Error("WriteConflict"), { code: 112, errorLabels: ["TransientTransactionError"] });
      }
    }
  }
  const result = await baseUpdateOne(filter, update, options);
  if (!options.session && txn.active && filter?._id !== undefined) txn.outside.set(String(filter._id), structuredClone(db.maap.get(String(filter._id))));
  return result;
};
FakeMaapEntry.updateOne = emulatedUpdateOne;

const ORIGIN = "http://localhost:5173";
const today = todayBusinessDate();
const daysAgo = (n) => addDays(today, -n);
const clone = (v) => JSON.parse(JSON.stringify(v));
const OPTS = () => ({ dates: [daysAgo(2), daysAgo(3), daysAgo(4)], joiningDate: daysAgo(60) });

let app;
let owner;
let apiCalls;
const send = (method, url, cookie, body) => {
  const req = request(app)[method](url).set("Origin", ORIGIN).set("Cookie", cookie);
  return body === undefined ? req : req.send(body);
};
const makeDeps = (over = {}) => ({
  api: async (method, url, body) => {
    apiCalls.push({ method: method.toLowerCase(), url, body });
    const res = await send(method.toLowerCase(), url, owner.cookie, body);
    return { status: res.status, body: res.body };
  },
  MaapEntry: FakeMaapEntry,
  readLabours: async (filter) => [...db.labours.values()].filter((r) => Object.entries(filter).every(([k, v]) => r[k] === v)).map(clone),
  readRates: async (id) => db.rates.filter((r) => r.labourId === id).map(clone),
  readEntries: async ({ labourId, date }) => [...db.maap.values()].filter((r) => r.labourId === labourId && r.date === date).map(clone),
  today: () => today,
  ...over,
});
const by = (result, id) => result.cases.find((c) => c.id === id);
const manualWorker = async (fields) => {
  const res = await send("post", "/api/labours", owner.cookie, { labourType: "MAAPVALI", village: "Test", joiningDate: daysAgo(60), ratePerFourMaaps: 100, ...fields });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.data.id;
};

beforeEach(() => {
  db.reset();
  users.list.length = 0;
  Object.assign(txn, { active: false, sessionOp: false, budget: 0, attempts: 0, outside: new Map() });
  apiCalls = [];
  app = createApp();
  const user = { _id: new mongoose.Types.ObjectId().toString(), name: "Ramesh Patel", email: "owner@example.com", role: "OWNER", isActive: true, tokenVersion: 0 };
  users.list.push(user);
  owner = { user, cookie: `brickpro_token=${signAccessToken(user)}` };
});

describe("mocked run can never reach a database", () => {
  it("has no connection string, and mongoose.connect / createConnection / connectDB were never called", async () => {
    expect(env.mongodbUri).toBe("");
    await runRace(makeDeps(), OPTS());
    expect(connectSpy).not.toHaveBeenCalled();
    expect(createConnectionSpy).not.toHaveBeenCalled();
    expect(connectBlocked).not.toHaveBeenCalled();
    expect(mongoose.connection.readyState).toBe(0);
  });

  it("the harness module imports nothing and contains no connection code", () => {
    const source = readFileSync(new URL("../scripts/lib/raceHarness.js", import.meta.url), "utf8");
    expect(source.split("\n").filter((l) => /^\s*import\b/.test(l))).toEqual([]);
    for (const forbidden of [/require\(/, /process\.env/, /\.connect\(/, /connectDB\(/, /createConnection\(/, /mongodb\+srv:\/\//]) expect(source).not.toMatch(forbidden);
  });

  it("the Atlas runner loads the database, the app and the models only AFTER the guards (dynamic imports)", () => {
    const source = readFileSync(new URL("../scripts/verifyRace.js", import.meta.url), "utf8");
    const staticImports = source.split("\n").filter((l) => /^import\b/.test(l));
    expect(staticImports.length).toBe(3);
    for (const line of staticImports) expect(line).not.toMatch(/config|app\.js|models|mongoose/);
    expect(source.indexOf("checkAtlasGuards({")).toBeLessThan(source.indexOf('await import("mongoose")'));
    expect(source.indexOf("process.exit(EXIT_CODES.REFUSED)")).toBeLessThan(source.indexOf('await import("mongoose")'));
  });
});

describe("index safety: nothing may build indexes or create collections (ordering and refusal)", () => {
  const at = (source, text) => {
    const i = source.indexOf(text);
    expect(i, `missing: ${text}`).toBeGreaterThan(-1);
    return i;
  };
  const fakeMongoose = ({ stuck = [], start = {} } = {}) => {
    const settings = new Map(Object.entries(start));
    return { set: (k, v) => { if (!stuck.includes(k)) settings.set(k, v); }, get: (k) => settings.get(k) };
  };

  it("the runner forces autoIndex/autoCreate off AFTER importing config/db.js and BEFORE connecting, the app and every model", () => {
    const source = readFileSync(new URL("../scripts/verifyRace.js", import.meta.url), "utf8");
    const dbImport = at(source, 'await import("../config/db.js")');
    const apply = at(source, "applyIndexSafety(mongoose)");
    const recheck = at(source, "indexSafetyProblem(mongoose)");
    expect(dbImport).toBeLessThan(apply);
    expect(apply).toBeLessThan(at(source, "await connectDB("));
    expect(apply).toBeLessThan(recheck);
    for (const loader of ['await import("../app.js")', 'await import("../models/MaapEntry.js")', 'await import("../models/Labour.js")', 'await import("../models/LabourRateHistory.js")']) {
      expect(recheck, loader).toBeLessThan(at(source, loader)); // the second check is right before any model can load
    }
    expect(source).not.toMatch(/mongoose\.set\(/); // the only place the settings are changed is applyIndexSafety, after the db.js import
  });

  it("the runner refuses (exit 2) when a setting did not turn off, both before connecting and again before the models", () => {
    const source = readFileSync(new URL("../scripts/verifyRace.js", import.meta.url), "utf8");
    expect(source).toMatch(/if \(unsafeBeforeConnect\) \{[^}]*process\.exit\(EXIT_CODES\.REFUSED\)/s);
    expect(source).toMatch(/else if \(indexSafetyProblem\(mongoose\)\) \{[^}]*exitCode = EXIT_CODES\.REFUSED/s);
  });

  it("applyIndexSafety turns a re-enabled autoIndex (what importing config/db.js does) back off", () => {
    const m = fakeMongoose({ start: { autoIndex: true, autoCreate: true } }); // as left behind by config/db.js outside production
    expect(indexSafetyProblem(m)).toMatch(/autoIndex and autoCreate are not false/);
    expect(applyIndexSafety(m)).toBeNull();
    expect([m.get("autoIndex"), m.get("autoCreate")]).toEqual([false, false]);
  });

  it("refuses when a setting stays on, or was never set to false", () => {
    expect(applyIndexSafety(fakeMongoose({ stuck: ["autoIndex"], start: { autoIndex: true } }))).toMatch(/autoIndex is not false/);
    expect(applyIndexSafety(fakeMongoose({ stuck: ["autoCreate"], start: { autoCreate: true } }))).toMatch(/autoCreate is not false/);
    expect(applyIndexSafety(fakeMongoose({ stuck: ["autoIndex", "autoCreate"] }))).toMatch(/autoIndex and autoCreate are not false/);
    expect(indexSafetyProblem(fakeMongoose())).not.toBeNull(); // unset is not "false": refuse
    expect(indexSafetyProblem(fakeMongoose({ start: { autoIndex: false, autoCreate: false } }))).toBeNull();
  });

  it("proof with the REAL config/db.js (imported, never connected): it turns autoIndex ON, and applyIndexSafety turns it off", () => {
    const server = fileURLToPath(new URL("..", import.meta.url));
    const code = `
      import { createRequire } from "node:module";
      const mongoose = createRequire(${JSON.stringify(`${server}package.json`)})("mongoose");
      await import(${JSON.stringify(`file://${server.replace(/\\/g, "/")}config/db.js`)});
      const afterDb = mongoose.get("autoIndex");
      const h = await import(${JSON.stringify(`file://${server.replace(/\\/g, "/")}scripts/lib/raceHarness.js`)});
      const problem = h.applyIndexSafety(mongoose);
      console.log(JSON.stringify({ afterDb, afterFix: [mongoose.get("autoIndex"), mongoose.get("autoCreate")], problem, readyState: mongoose.connection.readyState }));
      process.exit(0);`;
    const out = spawnSync(process.execPath, ["--input-type=module", "-e", code], {
      cwd: os.tmpdir(), encoding: "utf8", timeout: 20000,
      env: { PATH: process.env.PATH ?? "", SystemRoot: process.env.SystemRoot ?? "", NODE_ENV: "development", JWT_SECRET: "unit-test-secret-that-is-long-enough-0123456789", CLIENT_ORIGIN: "http://localhost:5173", MONGODB_URI: "mongodb://127.0.0.1:1/x_test" },
    });
    expect(out.status, out.stderr).toBe(0);
    expect(JSON.parse(out.stdout.trim().split("\n").pop())).toEqual({ afterDb: true, afterFix: [false, false], problem: null, readyState: 0 });
  });
});

describe("request bodies match the real validators", () => {
  const ids = { X: "L-001", Y: "L-002" };
  it("seed and batch bodies are accepted by saveDaySchema (both row orders)", () => {
    expect(saveDaySchema.safeParse(bodies.seed(ids)).success).toBe(true);
    for (const spec of CASES) expect(saveDaySchema.safeParse(bodies.batch(spec.order, ids)).success).toBe(true);
  });
  it("the rival PATCH body is accepted; `reason` is required and `date` is NOT", () => {
    expect(correctionSchema.safeParse(bodies.rival()).success).toBe(true);
    expect(correctionSchema.safeParse({ numberOfMaaps: 50 }).success).toBe(false); // reason missing
    expect(correctionSchema.safeParse({ reason: "ZZ RACE rival" }).success).toBe(false); // nothing to change
    expect(correctionSchema.safeParse({ date: daysAgo(3), reason: "ZZ RACE rival" }).success).toBe(true);
    expect(Object.keys(bodies.rival()).sort()).toEqual(["numberOfMaaps", "reason"]);
  });
});

describe("the full race run (R1, R2, R3)", () => {
  for (const [label, budget, expectedR1] of [["direct mismatch (no retry)", 0, [1, 1]], ["one write-conflict retry", 1, [2, 2]]]) {
    it(`passes with ${label}`, async () => {
      txn.budget = budget;
      const result = await runRace(makeDeps(), OPTS());
      expect(result.verdict, JSON.stringify(result.cases.map((c) => [c.id, c.verdict, c.fails, c.inconclusive]))).toBe("PASS");
      const [r1, r2, r3] = ["R1", "R2", "R3"].map((id) => by(result, id));
      expect([r1.counts.upsert, r1.counts.guarded]).toEqual(expectedR1);
      expect([r2.counts.upsert, r2.counts.guarded]).toEqual([1, 1]);
      expect([r3.counts.upsert, r3.counts.guarded]).toEqual([1, 1]);
      expect(r2.ops).toEqual(["guarded", "upsert"]); // R2: Y's row was really written inside the transaction, then rolled back
      for (const c of [r1, r2]) expect(c.events.map((e) => e.name)).toEqual(["rival-start", "rival-http", "rival-verified", "guarded-invoked"]);
      expect(FakeMaapEntry.updateOne).toBe(emulatedUpdateOne); // the observation hook was removed again
    });
  }

  it("R1 really takes the retry path with a write conflict, and rolls back the new row", async () => {
    txn.budget = 1;
    await runRace(makeDeps(), OPTS());
    expect(txn.budget).toBe(0);
    const y = [...db.labours.values()].find((l) => l.name === FIXTURE.workers.Y.name)._id;
    expect([...db.maap.values()].filter((r) => r.labourId === y && r.date === daysAgo(2))).toEqual([]); // R1 date: nothing left for Y
    expect([...db.maap.values()].filter((r) => r.labourId === y && r.date === daysAgo(3))).toEqual([]); // R2 date
    expect([...db.maap.values()].filter((r) => r.labourId === y && r.date === daysAgo(4))).toHaveLength(1); // R3 control saved it
  });

  it("the rival is applied exactly once per race case and is never intercepted (no recursion)", async () => {
    const result = await runRace(makeDeps(), OPTS());
    const patches = apiCalls.filter((c) => c.method === "patch");
    expect(patches).toHaveLength(2);
    expect(patches.every((p) => p.body.reason === FIXTURE.reasons.rival && p.body.numberOfMaaps === AMOUNTS.rival)).toBe(true);
    for (const id of ["R1", "R2"]) {
      expect(by(result, id).counts.passedThroughWhileFiring).toBe(1);
      expect(by(result, id).checks.rivalPassedThroughOnce).toBe(true);
    }
  });

  it("R3 is a genuine control: hook never armed, no rival PATCH, ordinary save", async () => {
    const result = await runRace(makeDeps(), OPTS());
    const r3 = by(result, "R3");
    expect(r3.verdict).toBe("PASS");
    expect(r3.checks.hookNeverArmed).toBe(true);
    expect(r3.checks.noRivalRequests).toBe(true);
    expect(r3.events).toEqual([]); // no rival event of any kind
    expect(apiCalls.filter((c) => c.method === "patch" && c.url.includes(OPTS().dates[2]))).toEqual([]);
    expect(apiCalls.filter((c) => c.method === "put" && c.url.endsWith(OPTS().dates[2]))).toHaveLength(2); // seed + batch only
  });

  it("backdated saves and corrections always carry a reason", async () => {
    await runRace(makeDeps(), OPTS());
    for (const call of apiCalls.filter((c) => ["put", "patch"].includes(c.method))) expect(String(call.body.reason ?? "").length).toBeGreaterThanOrEqual(3);
  });
});

describe("strict classification: anything unexpected is never PASS", () => {
  const withApi = (handler) => {
    const base = makeDeps();
    return { ...base, api: (method, url, body) => handler(base.api, method.toLowerCase(), url, body) };
  };
  const isBatch = (method, url, date, body) => method === "put" && url.endsWith(date) && body.reason === FIXTURE.reasons.batch;

  it("hook never fires -> INCONCLUSIVE (race was not created)", async () => {
    const dates = OPTS().dates;
    const deps = withApi((api, method, url, body) => (isBatch(method, url, dates[0], body) ? api(method, url, { ...body, rows: body.rows.map((r) => (r.maaps === AMOUNTS.batchX ? { ...r, maaps: AMOUNTS.seed } : r)) }) : api(method, url, body)));
    const result = await runRace(deps, OPTS());
    expect(by(result, "R1").verdict).toBe("INCONCLUSIVE");
    expect(by(result, "R1").inconclusive.join(" ")).toMatch(/HOOK_NOT_FIRED/);
    expect(result.verdict).toBe("INCONCLUSIVE");
  });

  it("watchdog timeout -> INCONCLUSIVE, later cases are NOT RUN, hook restored", async () => {
    const dates = OPTS().dates;
    const deps = withApi((api, method, url, body) => (isBatch(method, url, dates[0], body) ? new Promise(() => {}) : api(method, url, body)));
    const result = await runRace(deps, { ...OPTS(), watchdogMs: 40 });
    expect(by(result, "R1").inconclusive.join(" ")).toMatch(/WATCHDOG/);
    expect(by(result, "R2").inconclusive.join(" ")).toMatch(/NOT_RUN/);
    expect(by(result, "R3").inconclusive.join(" ")).toMatch(/NOT_RUN/);
    expect(result.verdict).toBe("INCONCLUSIVE");
    expect(FakeMaapEntry.updateOne).toBe(emulatedUpdateOne);
  });

  it("unexpected HTTP response from the batch -> FAIL", async () => {
    const dates = OPTS().dates;
    const deps = withApi(async (api, method, url, body) => {
      const real = await api(method, url, body);
      return isBatch(method, url, dates[1], body) ? { status: 500, body: { success: false, message: "boom" } } : real;
    });
    const result = await runRace(deps, OPTS());
    expect(by(result, "R2").verdict).toBe("FAIL");
    expect(by(result, "R2").fails.join(" ")).toMatch(/batchHttp409/);
    expect(result.verdict).toBe("FAIL");
  });

  it("unexpected retry count -> FAIL", async () => {
    txn.budget = 3; // four attempts instead of at most two
    const result = await runRace(makeDeps(), OPTS());
    expect(by(result, "R1").verdict).toBe("FAIL");
    expect(by(result, "R1").fails.join(" ")).toMatch(/retryCounts|opSequence/);
    expect(result.verdict).toBe("FAIL");
  });

  it("an incorrect final database state -> FAIL", async () => {
    const dates = OPTS().dates;
    let tampered = false;
    const base = makeDeps();
    const deps = {
      ...base,
      api: async (method, url, body) => {
        const reply = await base.api(method, url, body);
        if (isBatch(method.toLowerCase(), url, dates[1], body)) tampered = true;
        return reply;
      },
      readEntries: async (q) => {
        const rows = await base.readEntries(q);
        const y = [...db.labours.values()].find((l) => l.name === FIXTURE.workers.Y.name)?._id;
        return tampered && q.labourId === y && q.date === dates[1] ? [...rows, { _id: "phantom", labourId: y, date: q.date, numberOfMaaps: 5, revision: 1, isDeleted: false }] : rows;
      },
    };
    const result = await runRace(deps, OPTS());
    expect(by(result, "R2").verdict).toBe("FAIL");
    expect(by(result, "R2").fails.join(" ")).toMatch(/yHasNoEntry/);
  });

  it("the rival PATCH not returning 200 -> INCONCLUSIVE (the race was not created)", async () => {
    const deps = withApi(async (api, method, url, body) => (method === "patch" ? { status: 400, body: { success: false } } : api(method, url, body)));
    const result = await runRace(deps, OPTS());
    expect(by(result, "R1").verdict).toBe("INCONCLUSIVE");
    expect(by(result, "R1").inconclusive.join(" ")).toMatch(/RIVAL_HTTP_400/);
    expect(result.verdict).toBe("INCONCLUSIVE");
  });

  it("a case that skips a required check can never be PASS", async () => {
    const result = await runRace(makeDeps(), OPTS());
    const r1 = by(result, "R1");
    expect(r1.verdict).toBe("PASS");
    for (const name of ["rivalFiredOnce", "rivalPatch200", "rivalRev2Committed", "eventOrder", "batchHttp409", "yHasNoEntry", "xRivalState", "hookRestored"]) expect(r1.checks[name]).toBe(true);
  });

  it("an invalid, future or reused date set is refused or INCONCLUSIVE, never PASS", async () => {
    expect((await runRace(makeDeps(), { ...OPTS(), dates: [today, daysAgo(3), daysAgo(4)] })).verdict).toBe("REFUSED");
    expect((await runRace(makeDeps(), { ...OPTS(), dates: [daysAgo(3), daysAgo(3), daysAgo(4)] })).verdict).toBe("REFUSED");
    expect((await runRace(makeDeps(), { ...OPTS(), dates: [daysAgo(70), daysAgo(3), daysAgo(4)] })).verdict).toBe("REFUSED");
    expect(db.labours.size).toBe(0); // refused before any fixture was created
  });
});

describe("fixtures are idempotent, collision-safe, and never overwrite or delete", () => {
  it("a second run with the SAME dates is REFUSED before any write (every date is already used)", async () => {
    expect((await runRace(makeDeps(), OPTS())).verdict).toBe("PASS");
    const before = JSON.stringify({ l: [...db.labours.values()], m: [...db.maap.values()], r: db.rates });
    apiCalls = [];
    const again = await runRace(makeDeps(), OPTS());
    expect(again.verdict).toBe("REFUSED");
    expect(again.cases).toEqual([]);
    for (const date of OPTS().dates) expect(again.reason).toContain(`on ${date}`);
    expect(again.reason).toMatch(/DATE_USED/);
    expect(apiCalls).toEqual([]); // not a single request: no login-free read, no write
    expect(JSON.stringify({ l: [...db.labours.values()], m: [...db.maap.values()], r: db.rates })).toBe(before);
  });

  it("a second run with NEW dates reuses the existing workers (no new worker created)", async () => {
    expect((await runRace(makeDeps(), OPTS())).verdict).toBe("PASS");
    apiCalls = [];
    const again = await runRace(makeDeps(), { ...OPTS(), dates: [daysAgo(5), daysAgo(6), daysAgo(7)] });
    expect(again.verdict).toBe("PASS");
    expect(again.fixtures.created).toEqual([]);
    expect(again.fixtures.reused).toEqual(["X", "Y"]);
    expect(apiCalls.filter((c) => c.url === "/api/labours")).toEqual([]);
  });

  it("an unrelated worker and entry are never changed", async () => {
    const other = await manualWorker({ name: "Someone Real", mobile: "9876543210" });
    await send("put", `/api/maap-entries/day/${daysAgo(3)}`, owner.cookie, { reason: "unrelated", rows: [{ labourId: other, maaps: 7 }] });
    const before = JSON.stringify({ l: db.labours.get(other), m: [...db.maap.values()].filter((r) => r.labourId === other) });
    expect((await runRace(makeDeps(), OPTS())).verdict).toBe("PASS");
    expect(JSON.stringify({ l: db.labours.get(other), m: [...db.maap.values()].filter((r) => r.labourId === other) })).toBe(before);
  });

  for (const [label, fields, text] of [
    ["the mobile belongs to a different worker", { name: "Someone Else", mobile: FIXTURE.workers.X.mobile }, /COLLISION/],
    ["the name exists with a different mobile", { name: FIXTURE.workers.X.name, mobile: "9876500001" }, /COLLISION/],
    ["the worker exists with a different rate", { name: FIXTURE.workers.X.name, mobile: FIXTURE.workers.X.mobile, ratePerFourMaaps: 120 }, /COLLISION/],
  ]) {
    it(`REFUSED with no writes when ${label}`, async () => {
      await manualWorker(fields);
      const before = JSON.stringify({ l: [...db.labours.values()], m: [...db.maap.values()], r: db.rates });
      apiCalls = [];
      const result = await runRace(makeDeps(), OPTS());
      expect(result.verdict).toBe("REFUSED");
      expect(result.reason).toMatch(text);
      expect(apiCalls.filter((c) => c.method !== "get")).toEqual([]);
      expect(JSON.stringify({ l: [...db.labours.values()], m: [...db.maap.values()], r: db.rates })).toBe(before);
    });
  }
});

describe("runCase on its own: the hook is restored even when the batch fails", () => {
  it("restores MaapEntry.updateOne after a thrown request", async () => {
    const base = makeDeps();
    const ids = {};
    const fixtures = await runRace(base, OPTS());
    expect(fixtures.verdict).toBe("PASS");
    for (const key of ["X", "Y"]) ids[key] = [...db.labours.values()].find((l) => l.name === FIXTURE.workers[key].name)._id;
    const deps = { ...base, api: async (method, url, body) => { if (method === "put" && body?.reason === FIXTURE.reasons.batch) throw new Error("network down"); return base.api(method, url, body); } };
    const result = await runCase(deps, CASES[0], { date: daysAgo(8), ids, watchdogMs: 200 });
    expect(result.verdict).toBe("INCONCLUSIVE");
    expect(FakeMaapEntry.updateOne).toBe(emulatedUpdateOne);
  });
});

describe("Atlas runner guards (pure function, nothing connects)", () => {
  const good = { argv: ["--mode", "atlas", "--confirm-db", "aayush_carting_test", "--i-understand-this-writes-test-data"], env: { MONGODB_URI: "mongodb+srv://u:p@cluster0.example.net/aayush_carting_test?retryWrites=true", OWNER_EMAIL: "a@b.co", OWNER_PASSWORD: "pw" } };
  const problem = (argv, env) => checkAtlasGuards({ argv: argv ?? good.argv, env: { ...good.env, ...env } });

  it("accepts only a confirmed _test database", () => {
    expect(checkAtlasGuards(good)).toMatchObject({ ok: true, dbName: "aayush_carting_test" });
    expect(problem(undefined, { MONGODB_URI: "mongodb://u:p@h/Aayush_TEST" }).ok).toBe(false); // wrong confirm text (case differs)
    expect(checkAtlasGuards({ argv: ["--mode", "atlas", "--confirm-db", "X_TEST", "--i-understand-this-writes-test-data"], env: { ...good.env, MONGODB_URI: "mongodb://u:p@h/X_TEST" } }).ok).toBe(true); // _test is case-insensitive
  });

  it("refuses every unsafe or incomplete setup", () => {
    const cases = [
      [["--confirm-db", "aayush_carting_test", "--i-understand-this-writes-test-data"], {}, /--mode atlas/],
      [["--mode", "mocked", "--confirm-db", "aayush_carting_test", "--i-understand-this-writes-test-data"], {}, /--mode atlas/],
      [["--mode", "atlas", "--confirm-db", "aayush_carting_test"], {}, /i-understand/],
      [undefined, { NODE_ENV: "production" }, /production/],
      [undefined, { NODE_ENV: "PRODUCTION" }, /production/],
      [undefined, { MONGODB_URI: "mongodb://u:p@h/aayush_carting" }, /does not end with/],
      [undefined, { MONGODB_URI: "mongodb://u:p@h/prodtest" }, /does not end with/],
      [undefined, { MONGODB_URI: "mongodb://u:p@h/brickpro_test_backup" }, /does not end with/],
      [undefined, { MONGODB_URI: "mongodb+srv://u:p@h/?retryWrites=true" }, /no database name/],
      [undefined, { MONGODB_URI: "" }, /no database name/],
      [["--mode", "atlas", "--confirm-db", "other_test", "--i-understand-this-writes-test-data"], {}, /--confirm-db aayush_carting_test/],
      [["--mode", "atlas", "--i-understand-this-writes-test-data"], {}, /--confirm-db/],
      [undefined, { OWNER_PASSWORD: "" }, /OWNER_EMAIL and OWNER_PASSWORD/],
      [[...good.argv, "--dates", "2026-11-12,2026-11-12,2026-11-10"], {}, /three different dates/],
      [[...good.argv, "--dates", "yesterday,today,tomorrow"], {}, /three different dates/],
    ];
    for (const [argv, env, text] of cases) {
      const result = problem(argv, env);
      expect(result.ok, JSON.stringify([argv, env])).toBe(false);
      expect(result.problem).toMatch(text);
      expect(result.problem).not.toMatch(/u:p@|cluster0/); // never echoes the connection string
    }
  });

  it("parses the database name only", () => {
    expect(parseDbName("mongodb+srv://user:secret@cluster0.example.net/db_test?x=1")).toBe("db_test");
    expect(parseDbName("mongodb://localhost:27017/")).toBe("");
  });
});

describe("the runner script refuses in a child process BEFORE connecting (dummy values only, local address, no real database)", () => {
  const script = fileURLToPath(new URL("../scripts/verifyRace.js", import.meta.url));
  const run = (args, extra = {}) =>
    spawnSync(process.execPath, [script, ...args], {
      cwd: os.tmpdir(), // no .env is read from here
      encoding: "utf8",
      timeout: 20000,
      env: { PATH: process.env.PATH ?? "", SystemRoot: process.env.SystemRoot ?? "", MONGODB_URI: "mongodb://dummy-user:dummy-secret@127.0.0.1:1/brickpro", OWNER_EMAIL: "a@b.co", OWNER_PASSWORD: "dummy-secret-pw", ...extra },
    });
  for (const [label, args, extra] of [
    ["no arguments", [], {}],
    ["no --mode atlas", ["--confirm-db", "brickpro", "--i-understand-this-writes-test-data"], {}],
    ["a database name that is not _test", ["--mode", "atlas", "--confirm-db", "brickpro", "--i-understand-this-writes-test-data"], {}],
    ["a mismatching --confirm-db", ["--mode", "atlas", "--confirm-db", "other_test", "--i-understand-this-writes-test-data"], { MONGODB_URI: "mongodb://dummy-user:dummy-secret@127.0.0.1:1/brickpro_test" }],
    ["NODE_ENV=production", ["--mode", "atlas", "--confirm-db", "brickpro_test", "--i-understand-this-writes-test-data"], { NODE_ENV: "production", MONGODB_URI: "mongodb://dummy-user:dummy-secret@127.0.0.1:1/brickpro_test" }],
  ]) {
    it(`exits 2 and prints no secret: ${label}`, () => {
      const out = run(args, extra);
      expect(out.status).toBe(2);
      expect(`${out.stdout}${out.stderr}`).toMatch(/Refusing/);
      expect(`${out.stdout}${out.stderr}`).not.toMatch(/dummy-secret|127\.0\.0\.1/);
    });
  }
});

describe("preflight: a complete READ-ONLY pre-scan refuses the whole run before the first write", () => {
  const fixtureWorker = async (key, over = {}) => manualWorker({ name: FIXTURE.workers[key].name, mobile: FIXTURE.workers[key].mobile, ...over });
  const putDay = (labourId, date, maaps = 3) => send("put", `/api/maap-entries/day/${date}`, owner.cookie, { reason: "pre-existing", rows: [{ labourId, maaps }] });
  const snapshot = () => JSON.stringify({ l: [...db.labours.values()], m: [...db.maap.values()], r: db.rates, c: db.counters });
  const expectNothingWritten = (before) => {
    expect(apiCalls).toEqual([]); // the harness issued no request at all (its writes all go through the API)
    expect(snapshot()).toBe(before);
  };

  it("1. X absent and Y collides: NEITHER worker is created", async () => {
    await manualWorker({ name: "Someone Else", mobile: FIXTURE.workers.Y.mobile });
    const before = snapshot();
    const result = await runRace(makeDeps(), OPTS());
    expect(result.verdict).toBe("REFUSED");
    expect(result.reason).toMatch(/COLLISION/);
    expectNothingWritten(before);
    expect([...db.labours.values()].some((l) => l.name === FIXTURE.workers.X.name)).toBe(false);
  });

  it("1b. X absent and Y has the wrong rate: X is not created either", async () => {
    await fixtureWorker("Y", { ratePerFourMaaps: 120 });
    const before = snapshot();
    const result = await runRace(makeDeps(), OPTS());
    expect(result.verdict).toBe("REFUSED");
    expect(result.reason).toMatch(/exactly one rate row/);
    expectNothingWritten(before);
  });

  it("2. R1's date unused but R2's date already used: no fixture and no entry is created", async () => {
    const x = await fixtureWorker("X");
    await fixtureWorker("Y");
    await putDay(x, OPTS().dates[1]);
    const before = snapshot();
    apiCalls = [];
    const result = await runRace(makeDeps(), OPTS());
    expect(result.verdict).toBe("REFUSED");
    expect(result.reason).toContain(`on ${OPTS().dates[1]}`);
    expect(result.reason).not.toContain(`on ${OPTS().dates[0]}`);
    expectNothingWritten(before);
    expect([...db.maap.values()].filter((r) => r.date === OPTS().dates[0])).toEqual([]); // R1 never ran
  });

  it("3. R3's date already used (by Y): no fixture and no entry is created", async () => {
    await fixtureWorker("X");
    const y = await fixtureWorker("Y");
    await putDay(y, OPTS().dates[2]);
    const before = snapshot();
    apiCalls = [];
    const result = await runRace(makeDeps(), OPTS());
    expect(result.verdict).toBe("REFUSED");
    expect(result.reason).toContain(`on ${OPTS().dates[2]}`);
    expectNothingWritten(before);
  });

  it("3b. a DELETED entry on a case date also counts as used", async () => {
    const x = await fixtureWorker("X");
    await fixtureWorker("Y");
    const saved = await putDay(x, OPTS().dates[0]);
    expect(saved.status).toBe(200);
    const entry = [...db.maap.values()].find((r) => r.labourId === x);
    const removed = await send("delete", `/api/maap-entries/${entry._id}`, owner.cookie, { reason: "pre-existing removal" });
    expect(removed.status, JSON.stringify(removed.body)).toBe(200);
    expect([...db.maap.values()].find((r) => r._id === entry._id).isDeleted).toBe(true);
    const before = snapshot();
    apiCalls = [];
    const result = await runRace(makeDeps(), OPTS());
    expect(result.verdict).toBe("REFUSED");
    expect(result.reason).toContain(`on ${OPTS().dates[0]}`);
    expectNothingWritten(before);
  });

  it("all problems are reported together and nothing is written", async () => {
    const x = await fixtureWorker("X");
    await manualWorker({ name: "Someone Else", mobile: FIXTURE.workers.Y.mobile });
    await putDay(x, OPTS().dates[1]);
    const before = snapshot();
    apiCalls = [];
    const result = await runRace(makeDeps(), OPTS());
    expect(result.verdict).toBe("REFUSED");
    expect(result.reason).toMatch(/COLLISION/);
    expect(result.reason).toMatch(/DATE_USED/);
    expectNothingWritten(before);
  });

  it("4. all checks pass: fixture creation proceeds, and every preflight read happens before the first write", async () => {
    const order = [];
    const base = makeDeps();
    const deps = {
      ...base,
      api: (m, u, b) => { order.push(`api:${m.toLowerCase()}`); return base.api(m, u, b); },
      readLabours: (f) => { order.push("read:labours"); return base.readLabours(f); },
      readRates: (id) => { order.push("read:rates"); return base.readRates(id); },
      readEntries: (q) => { order.push("read:entries"); return base.readEntries(q); },
    };
    const result = await runRace(deps, OPTS());
    expect(result.verdict).toBe("PASS");
    expect(result.fixtures.created).toEqual(["X", "Y"]);
    const firstWrite = order.findIndex((o) => o === "api:post" || o === "api:put" || o === "api:patch");
    expect(firstWrite).toBeGreaterThan(0);
    expect(order.slice(0, firstWrite).every((o) => o.startsWith("read:"))).toBe(true);
    expect(order.slice(0, firstWrite).filter((o) => o === "read:labours")).toHaveLength(4); // X and Y, by mobile and by name
    expect(order[firstWrite]).toBe("api:post"); // the first write is the creation of a fixture worker
  });

  it("4b. workers present and every date unused: all 6 worker/date pairs are scanned (deleted included) before the first write", async () => {
    const x = await fixtureWorker("X");
    const y = await fixtureWorker("Y");
    const order = [];
    const pairs = [];
    const base = makeDeps();
    const deps = {
      ...base,
      api: (m, u, b) => { order.push(`api:${m.toLowerCase()}`); return base.api(m, u, b); },
      readLabours: (f) => { order.push("read:labours"); return base.readLabours(f); },
      readRates: (id) => { order.push("read:rates"); return base.readRates(id); },
      readEntries: (q) => { order.push("read:entries"); pairs.push(`${q.labourId}|${q.date}`); return base.readEntries(q); },
    };
    expect((await runRace(deps, OPTS())).verdict).toBe("PASS");
    const firstWrite = order.findIndex((o) => o.startsWith("api:"));
    const before = order.slice(0, firstWrite);
    expect(before.filter((o) => o === "read:rates")).toHaveLength(2);
    expect(before.filter((o) => o === "read:labours")).toHaveLength(4);
    const scanned = new Set(pairs.slice(0, before.filter((o) => o === "read:entries").length));
    for (const id of [x, y]) for (const date of OPTS().dates) expect(scanned.has(`${id}|${date}`), `${id} ${date}`).toBe(true); // all 6 pairs, before any write
    expect(scanned.size).toBe(6);
  });

  it("preflight on its own never writes (direct call)", async () => {
    await fixtureWorker("X");
    const before = snapshot();
    apiCalls = [];
    const scan = await preflight(makeDeps(), OPTS().dates, [...OPTS().dates].sort()[0]);
    expect(scan.plan.X.state).toBe("usable");
    expect(scan.plan.Y.state).toBe("absent");
    expectNothingWritten(before);
  });
});

describe("cleanup: connections are destroyed before the listener closes, on every path", () => {
  const listen = () => new Promise((resolve) => { const s = http.createServer(() => {}); s.listen(0, "127.0.0.1", () => resolve(s)); }); // never answers: a stuck request
  const stuckClient = (server) => new Promise((resolve) => {
    const req = http.get({ host: "127.0.0.1", port: server.address().port, path: "/", agent: false }, () => {});
    req.on("error", () => {});
    server.once("connection", () => setTimeout(resolve, 20));
  });
  const settles = (promise, ms) => Promise.race([promise.then(() => true), new Promise((r) => setTimeout(() => r(false), ms))]);

  it("a request that never finishes does not keep shutdown waiting (plain close() would)", async () => {
    const plain = await listen();
    await stuckClient(plain);
    expect(await settles(new Promise((r) => plain.close(r)), 300)).toBe(false); // the problem the audit found
    plain.closeAllConnections();

    const server = await listen();
    await stuckClient(server);
    expect(await settles(shutdownServer(server), 3000)).toBe(true);
    expect(server.listening).toBe(false);
  });

  it("is safe with no server, and when called twice, and never throws", async () => {
    await expect(shutdownServer(undefined)).resolves.toBeUndefined();
    const server = await listen();
    await shutdownServer(server);
    await expect(shutdownServer(server)).resolves.toBeUndefined();
  });

  it("the runner cleans up in a finally block (success, failure, timeout, exception) and does nothing risky to the database", () => {
    const source = readFileSync(new URL("../scripts/verifyRace.js", import.meta.url), "utf8");
    const finallyBlock = source.slice(source.indexOf("} finally {"), source.indexOf("process.exit(exitCode)"));
    expect(finallyBlock).toMatch(/await shutdownServer\(server\)/);
    expect(finallyBlock).toMatch(/await disconnectDB\(\)/);
    expect(finallyBlock.indexOf("shutdownServer")).toBeLessThan(finallyBlock.indexOf("disconnectDB"));
    for (const file of ["../scripts/verifyRace.js", "../scripts/lib/raceHarness.js"]) {
      const text = readFileSync(new URL(file, import.meta.url), "utf8").split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
      for (const risky of [/deleteOne|deleteMany|\.drop\(|dropDatabase|dropIndex|createIndex|syncIndexes|findOneAndDelete|\.remove\(/, /api\("delete"/i, /"delete"/]) expect(text, `${file} ${risky}`).not.toMatch(risky);
    }
  });
});
