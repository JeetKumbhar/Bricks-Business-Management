import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import mongoose from "mongoose";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

// MOCKED ONLY. This file never connects to a database: MONGODB_URI is emptied BEFORE anything loads (dotenv does not override an
// existing variable), mongoose.connect / createConnection are replaced by functions that throw, ../config/db.js is mocked, and every
// model the services use is the in-memory fake. It tests the Patlavale harness (scripts/lib/patlavaleHarness.js) end to end against
// the REAL routes / validators / services, and the guards of the Atlas runner. A mocked PASS is NOT evidence about Atlas.
vi.hoisted(() => {
  process.env.NODE_ENV = "test";
  process.env.BCRYPT_ROUNDS = "4";
  process.env.CLIENT_ORIGIN = "http://localhost:5173";
  process.env.JWT_SECRET = "unit-test-secret-that-is-long-enough-0123456789";
  process.env.MONGODB_URI = "";
});

const { db, matches, makeAttendanceModel, makeCounterModel, makeLabourModel, makeMaapEntryModel, makePaymentModel, makeProductionEntryModel, makeRateModel, makeSeasonModel } = await import("./helpers/memoryDb.js");
const users = vi.hoisted(() => ({ list: [] }));
// Fake transaction: snapshot the production collection, run, and on failure roll back to it but KEEP what a rival committed outside the
// transaction. A "TransientTransactionError" re-runs the work, like session.withTransaction does.
const txn = vi.hoisted(() => ({ active: false, sessionOp: false, budget: 0, attempts: 0, outside: new Map() }));
const connectBlocked = vi.hoisted(() => vi.fn(() => { throw new Error("TEST SAFETY: a database connection was attempted in a mocked test"); }));

vi.mock("../config/db.js", () => ({ getDbStatus: async () => ({ status: "connected", name: "test" }), connectDB: connectBlocked, disconnectDB: async () => {} }));
vi.mock("../models/User.js", () => ({ default: { findById: (id) => ({ lean: async () => users.list.find((u) => String(u._id) === String(id)) ?? null }) } }));
vi.mock("../models/Counter.js", () => ({ default: makeCounterModel() }));
vi.mock("../utils/transaction.js", () => ({
  runInTransaction: async (work) => {
    for (let attempt = 1; attempt <= 8; attempt += 1) {
      txn.attempts += 1;
      const snapshot = new Map([...db.production].map(([k, v]) => [k, structuredClone(v)]));
      txn.active = true;
      txn.sessionOp = false;
      txn.outside = new Map();
      try {
        return await work({ fake: "session" });
      } catch (err) {
        db.production.clear();
        for (const [k, v] of snapshot) db.production.set(k, v);
        for (const [k, v] of txn.outside) db.production.set(k, structuredClone(v)); // the rival's committed write survives our rollback
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
vi.mock("../models/Season.js", async (importOriginal) => ({ default: makeSeasonModel((await importOriginal()).default) }));
vi.mock("../models/ProductionEntry.js", () => ({ default: makeProductionEntryModel() }));
vi.mock("../models/Payment.js", async (importOriginal) => ({ default: makePaymentModel((await importOriginal()).default) }));

const connectSpy = vi.spyOn(mongoose, "connect").mockImplementation(connectBlocked);
const createConnectionSpy = vi.spyOn(mongoose, "createConnection").mockImplementation(connectBlocked);

const { createApp } = await import("../app.js");
const { signAccessToken } = await import("../services/auth.service.js");
const { todayBusinessDate, addDays: appAddDays } = await import("../utils/dates.js");
const money = await import("../utils/money.js");
const { calculateProduction } = await import("../services/productionCalculations.js");
const FakeProduction = (await import("../models/ProductionEntry.js")).default;
const H = await import("../scripts/lib/patlavaleHarness.js");
const { EXIT_CODES, EXPECTED_CLUSTER_HOST, EXPECTED_DB, FIXTURE, GROUPS, MAX_TRANSACTION_OPS, PAYMENT_DEPENDENCY, REQUIRED, checkAtlasGuards, formatReport, groupVerdict, indexSafetyProblem, applyIndexSafety, liveConnectionProblem, overall, planDates, runGuarded, runPatlavale, runPreflight, stripComments, shutdownServer } = H;

// WriteConflict emulation (see raceHarness.test.js): inside a transaction, a guarded write whose target a rival committed after the
// snapshot raises a transient error (the transaction is retried). The first operation of an attempt takes its snapshot afterwards.
const baseUpdateOne = FakeProduction.updateOne;
FakeProduction.updateOne = async (filter, update, options = {}) => {
  if (options.session) {
    const first = !txn.sessionOp;
    txn.sessionOp = true;
    if (!first && filter?._id !== undefined && filter.revision !== undefined && txn.budget > 0) {
      const stored = db.production.get(String(filter._id));
      if (stored && stored.revision !== filter.revision) {
        txn.budget -= 1;
        throw Object.assign(new Error("WriteConflict"), { code: 112, errorLabels: ["TransientTransactionError"] });
      }
    }
  }
  const result = await baseUpdateOne(filter, update, options);
  if (!options.session && txn.active && filter?._id !== undefined) txn.outside.set(String(filter._id), structuredClone(db.production.get(String(filter._id))));
  return result;
};
const emulatedUpdateOne = FakeProduction.updateOne;

const ORIGIN = "http://localhost:5173";
const today = todayBusinessDate();
const BASE = FIXTURE.defaultWindowStart;
const clone = (v) => JSON.parse(JSON.stringify(v));
const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let app;
let owner;
let apiCalls;
let order;
const send = (method, url, cookie, body) => {
  const req = request(app)[method](url).set("Origin", ORIGIN).set("Cookie", cookie);
  return body === undefined ? req : req.send(body);
};
const track = (name, fn) => async (...args) => {
  order.push(name);
  return fn(...args);
};
const makeReadDeps = (over = {}) => ({
  readLabours: track("read", async (filter) => [...db.labours.values()].filter((r) => matches(r, filter)).map(clone)),
  readSeasons: track("read", async () => [...db.seasons.values()].map(clone)),
  readRates: track("read", async (id) => db.rates.filter((r) => r.labourId === id).map(clone)),
  readProduction: track("read", async (filter) => [...db.production.values()].filter((r) => matches(r, filter)).map(clone)),
  readPayments: track("read", async (filter) => [...db.payments.values()].filter((r) => matches(r, filter)).map(clone)),
  readSource: (relative) => readFile(path.join(serverDir, relative), "utf8"),
  money: { rupeesToPaise: money.rupeesToPaise, earningsPaiseForMaaps: money.earningsPaiseForMaaps },
  today: () => today,
  ...over,
});
const makeDeps = (over = {}) => ({
  ...makeReadDeps(),
  ProductionEntry: FakeProduction,
  api: async (method, url, body) => {
    order.push("api");
    apiCalls.push({ method: method.toLowerCase(), url, body });
    const res = await send(method.toLowerCase(), url, owner.cookie, body);
    return { status: res.status, body: res.body };
  },
  ...over,
});
const fullRun = async ({ deps = {}, opts = {} } = {}) =>
  runGuarded({
    readDeps: makeReadDeps(),
    startAndLogin: async () => {
      order.push("login");
      return makeDeps(deps);
    },
    opts: { base: BASE, mode: "MOCKED", ...opts },
  });
const snapshotStores = () => clone({ labours: [...db.labours], rates: db.rates, seasons: [...db.seasons], production: [...db.production], payments: [...db.payments], maap: [...db.maap], counters: db.counters });

// Pre-existing records, made through the real API: an old worker, an old season and an old production entry (all outside the window).
const seedExisting = async () => {
  const w = await send("post", "/api/labours", owner.cookie, { labourType: "PATLAVALE", name: "Old Team", mobile: "9000000001", village: "V", joiningDate: "2024-01-01", ratePer1000PayableBricks: 650 });
  expect(w.status, JSON.stringify(w.body)).toBe(201);
  const s = await send("post", "/api/seasons", owner.cookie, { name: "Old season", startDate: "2024-01-01", endDate: "2024-12-31" });
  expect(s.status).toBe(201);
  const e = await send("put", "/api/production-entries/day/2024-02-01", owner.cookie, { rows: [{ teamId: w.body.data.id, maaps: 4 }], reason: "old data" });
  expect(e.status, JSON.stringify(e.body)).toBe(200);
  return { teamId: w.body.data.id, seasonId: s.body.data.id };
};

beforeEach(() => {
  db.reset();
  users.list.length = 0;
  Object.assign(txn, { active: false, sessionOp: false, budget: 0, attempts: 0, outside: new Map() });
  FakeProduction.updateOne = emulatedUpdateOne;
  apiCalls = [];
  order = [];
  app = createApp();
  const user = { _id: new mongoose.Types.ObjectId().toString(), name: "Ramesh Patel", email: "owner@example.com", role: "OWNER", isActive: true, tokenVersion: 0 };
  users.list.push(user);
  owner = { user, cookie: `brickpro_token=${signAccessToken(user)}` };
});

describe("the mocked tests themselves can never reach a database", () => {
  it("connect attempts are blocked, the URI is empty and nothing connected during a full run", async () => {
    expect(process.env.MONGODB_URI).toBe("");
    await seedExisting();
    await fullRun();
    expect(connectSpy).not.toHaveBeenCalled();
    expect(createConnectionSpy).not.toHaveBeenCalled();
    expect(connectBlocked).not.toHaveBeenCalled();
    expect(mongoose.connection.readyState).toBe(0);
  });
  it("the harness module imports nothing at all, so importing it cannot connect or write", () => {
    const text = readFileSync(path.join(serverDir, "scripts/lib/patlavaleHarness.js"), "utf8");
    expect(text.match(/^\s*import\s/gm)).toBeNull();
    expect(text).not.toMatch(/\brequire\(|\bimport\(/);
  });
});

describe("a full mocked run (real routes, validators and services; in-memory storage)", () => {
  it("records every required check in every group, passes, and is labelled MOCKED (never PASS)", async () => {
    await seedExisting();
    const result = await fullRun();
    expect(result.verdict, JSON.stringify(Object.fromEntries(GROUPS.concat("FIXTURES").map((g) => [g, result.groups?.[g]?.fails])))).toBe("PASS");
    expect(result.mode).toBe("MOCKED");
    for (const name of Object.keys(REQUIRED)) {
      const g = result.groups[name];
      expect(Object.keys(g.checks).sort(), `${name}: recorded checks must equal the required list`).toEqual([...REQUIRED[name]].sort());
      expect(Object.values(g.checks).every((v) => v === true), `${name}: ${JSON.stringify(g.fails)}`).toBe(true);
      expect(groupVerdict(name, g)).toBe("PASS");
    }
    const lines = formatReport(result, { dbName: "none", host: "none" });
    expect(lines[0]).toBe("RESULT: MOCKED-PASS");
    expect(lines.some((l) => l.startsWith("RESULT: PASS"))).toBe(false);
    expect(lines.join("\n")).toContain("Test mode: MOCKED");
    expect(lines.join("\n")).toContain("No automatic cleanup was performed");
    expect(result.notes.join(" ")).toContain("does NOT prove real Atlas transaction behaviour");
  });

  it("the same result labelled ATLAS prints RESULT: PASS only when mode is ATLAS (mode is data, not inferred)", async () => {
    const result = await fullRun({ opts: { mode: "ATLAS" } });
    expect(formatReport(result)[0]).toBe("RESULT: PASS");
    expect(formatReport({ ...result, mode: "MOCKED" })[0]).toBe("RESULT: MOCKED-PASS");
  });

  it("reports fixture ids, seasons, dates and the entries created", async () => {
    const result = await fullRun();
    expect(Object.keys(result.created.teams)).toEqual(["A", "B", "C", "D", "E"]);
    expect(result.created.season1).toBeTruthy();
    expect(result.created.season2).toBeTruthy();
    expect(result.created.entries.length).toBeGreaterThanOrEqual(20);
    const text = formatReport(result, { dbName: EXPECTED_DB, host: EXPECTED_CLUSTER_HOST }).join("\n");
    expect(text).toContain(`Database: ${EXPECTED_DB}; cluster: ${EXPECTED_CLUSTER_HOST}`);
    expect(text).toContain("Test window: 2025-03-01..2025-05-20");
    for (const g of GROUPS) expect(text).toContain(`- ${g}: PASS`);
  });

  it("changes nothing that existed before, deletes nothing, cleans nothing up", async () => {
    const old = await seedExisting();
    const before = snapshotStores();
    const result = await fullRun();
    expect(result.verdict).toBe("PASS");
    const after = snapshotStores();
    for (const key of ["labours", "seasons", "production", "payments"]) {
      for (const [id, row] of before[key]) expect(after[key].find(([i]) => i === id), `${key} ${id} must still exist`).toBeTruthy();
      for (const [id, row] of before[key]) expect(after[key].find(([i]) => i === id)[1], `${key} ${id} must be unchanged`).toEqual(row);
    }
    expect(after.rates.filter((r) => r.labourId === old.teamId)).toEqual(before.rates.filter((r) => r.labourId === old.teamId));
    // no automatic cleanup: every created team, season and entry is still stored
    for (const id of Object.values(result.created.teams)) expect(db.labours.has(id)).toBe(true);
    expect(db.seasons.has(result.created.season1) && db.seasons.has(result.created.season2)).toBe(true);
    for (const id of result.created.entries) expect(db.production.has(id), `entry ${id}`).toBe(true);
    expect([...db.production.values()].filter((r) => r.isDeleted).length).toBeGreaterThanOrEqual(1);
  });

  it("every mutating request targets only records this run created (or the collections' create routes)", async () => {
    const old = await seedExisting();
    const oldEntry = [...db.production.keys()][0];
    const result = await fullRun();
    const createdEntries = new Set(result.created.entries);
    const createdTeams = new Set(Object.values(result.created.teams));
    const createdSeasons = new Set([result.created.season1, result.created.season2]);
    for (const call of apiCalls.filter((c) => c.method !== "get")) {
      const m = /^\/api\/(production-entries|seasons|labours)\/([^/]+)(?:\/(.*))?$/.exec(call.url);
      if (!m) continue;
      const [, area, id, rest] = m;
      if (area === "production-entries" && id === "day") {
        expect((call.body.rows ?? []).every((r) => [...createdTeams, FIXTURE.unknownTeamId].includes(r.teamId) || typeof r.teamId === "string")).toBe(true);
        expect(JSON.stringify(call.body)).not.toContain(old.teamId);
      } else if (area === "production-entries") expect(createdEntries.has(id), `${call.method} ${call.url}`).toBe(true);
      else if (area === "seasons") expect(createdSeasons.has(id)).toBe(true);
      else if (area === "labours") expect(createdTeams.has(id) && rest === "rates").toBe(true);
    }
    expect(apiCalls.some((c) => c.url.includes(oldEntry))).toBe(false);
    expect(apiCalls.some((c) => c.method === "delete" && !/^\/api\/production-entries\//.test(c.url))).toBe(false);
    const payments = apiCalls.filter((c) => c.url === "/api/payments");
    expect(payments).toHaveLength(1);
    expect(createdTeams.has(payments[0].body.recipientId)).toBe(true);
  });

  it("a repeat run on the same window is REFUSED by the preflight (fixtures were preserved), writing nothing", async () => {
    await fullRun();
    const before = snapshotStores();
    order = [];
    const again = await fullRun();
    expect(again.verdict).toBe("REFUSED");
    expect(again.reason).toMatch(/planned test name already exists/);
    expect(order).not.toContain("login");
    expect(order).not.toContain("api");
    expect(snapshotStores()).toEqual(before);
  });
});

describe("read-only preflight comes first and refuses on any collision", () => {
  const refused = async (label, mutate, pattern, opts = {}) => {
    await seedExisting();
    await mutate();
    const before = snapshotStores();
    order = [];
    const result = await fullRun({ opts });
    expect(result.verdict, label).toBe("REFUSED");
    expect(result.reason, label).toMatch(pattern);
    expect(order, label).not.toContain("login");
    expect(order, label).not.toContain("api");
    expect(result.loggedIn).toBe(false);
    expect(snapshotStores(), `${label}: nothing may be written`).toEqual(before);
  };
  const owner_ = () => owner.cookie;
  it("planned team name already used", () => refused("name", async () => { await send("post", "/api/labours", owner_(), { labourType: "MAAPVALI", name: FIXTURE.teams.C.name.toLowerCase(), mobile: "9111111111", village: "V", joiningDate: "2024-01-01", ratePerFourMaaps: 100 }); }, /planned test name/));
  it("planned mobile number already used", () => refused("mobile", async () => { await send("post", "/api/labours", owner_(), { labourType: "MAAPVALI", name: "Someone Else", mobile: FIXTURE.teams.B.mobile, village: "V", joiningDate: "2024-01-01", ratePerFourMaaps: 100 }); }, /planned test mobile/));
  it("the unknown-team id exists", () => refused("L-999999", async () => { db.labours.set("L-999999", { _id: "L-999999", name: "Existing", mobile: "9222222222", labourType: "MAAPVALI" }); }, /L-999999 exists/));
  it("a season with a planned name exists", () => refused("season name", async () => { await send("post", "/api/seasons", owner_(), { name: FIXTURE.seasons.s1.name, startDate: "2023-01-01", endDate: "2023-02-01" }); }, /season with a planned test name/));
  it("an existing season overlaps the window (open-ended or closed alike)", async () => {
    await refused("overlap", async () => { await send("post", "/api/seasons", owner_(), { name: "Real 2025", startDate: "2025-04-01", endDate: "2025-06-30" }); }, /overlap the test window/);
  });
  it("an open-ended season that started earlier overlaps too", () => refused("ongoing", async () => { db.seasons.clear(); await send("post", "/api/seasons", owner_(), { name: "Ongoing", startDate: "2025-01-01" }); }, /overlap the test window/));
  it("a LIVE production entry already sits inside the window", () => refused("live entry", async () => { const id = [...db.production.keys()][0]; db.production.get(id).date = "2025-03-20"; }, /production entr.*already exist/));
  it("a soft-DELETED production entry sits inside the window", () => refused("deleted entry", async () => { const id = [...db.production.keys()][0]; Object.assign(db.production.get(id), { date: "2025-05-10", isDeleted: true }); }, /production entr.*already exist/));
  it("the window is not entirely in the past", () => refused("future window", async () => {}, /entirely in the past/, { base: addDaysLocal(today, -10) }));
  it("an invalid window start", async () => {
    const r = await runPreflight(makeReadDeps(), { base: "2025-13-45" });
    expect(r.refused).toBe(true);
  });
  it("a clean database passes the preflight and reports counts (no login needed: only read deps are used)", async () => {
    await seedExisting();
    order = [];
    const r = await runPreflight(makeReadDeps(), { base: BASE });
    expect(r.refused).toBe(false);
    expect(r.counts).toEqual({ labours: 1, seasons: 1, entriesInWindow: 0 });
    expect(order.every((o) => o === "read")).toBe(true);
    expect(apiCalls).toHaveLength(0);
  });
  it("login happens after every preflight read and before the first API call", async () => {
    await fullRun();
    const login = order.indexOf("login");
    expect(login).toBeGreaterThan(0);
    expect(order.slice(0, login).every((o) => o === "read")).toBe(true);
    expect(order.indexOf("api")).toBeGreaterThan(login);
    expect(order.slice(0, login).length).toBe(3); // labours, seasons, production window
  });
  it("a refused login refuses the run and nothing is written", async () => {
    const before = snapshotStores();
    const result = await runGuarded({ readDeps: makeReadDeps(), startAndLogin: async () => ({ refused: "the TEST owner login returned HTTP 401. Nothing else was written." }), opts: { base: BASE, mode: "MOCKED" } });
    expect(result.verdict).toBe("REFUSED");
    expect(snapshotStores()).toEqual(before);
  });
});

function addDaysLocal(date, n) {
  return appAddDays(date, n);
}

describe("strict classification: only a complete, fully passing run is PASS", () => {
  it("a wrong server answer in one required check is FAIL, never PASS", async () => {
    // pretend the server accepted a decimal maap count
    const result = await fullRun({
      deps: {
        api: async (method, url, body) => {
          apiCalls.push({ method, url, body });
          if (method === "put" && JSON.stringify(body?.rows ?? "").includes("1.5")) return { status: 200, body: { data: {} } };
          const res = await send(method, url, owner.cookie, body);
          return { status: res.status, body: res.body };
        },
      },
    });
    expect(result.verdict).toBe("FAIL");
    expect(result.groups.P2.fails.join()).toContain("rejectDecimal");
    expect(formatReport(result)[0]).toMatch(/^RESULT: MOCKED-FAIL/);
  });
  it("a wrong stored value is FAIL (earnings stored with a floored value)", async () => {
    const result = await fullRun({
      deps: {
        readProduction: async (filter) => [...db.production.values()].filter((r) => matches(r, filter)).map((r) => ({ ...clone(r), earningsPaise: r.numberOfMaaps === 1 && r.ratePaise === 70000 ? 0 : r.earningsPaise })),
      },
    });
    expect(result.verdict).toBe("FAIL");
    expect(result.groups.P1.fails.join()).toContain("earn_1");
  });
  it("a rejected request that leaves a partial entry behind is FAIL (noPartialEntries bites)", async () => {
    const bad = planDates(BASE).p2.invalid;
    const result = await fullRun({
      deps: {
        api: async (method, url, body) => {
          const res = await send(method, url, owner.cookie, body);
          if (method === "put" && url.endsWith(bad) && res.status === 400 && !db.production.has("stray")) {
            const some = [...db.production.values()][0];
            db.production.set("stray", { ...clone(some), _id: "stray", date: bad, teamId: body.rows[0].teamId });
          }
          return { status: res.status, body: res.body };
        },
      },
    });
    expect(result.verdict).toBe("FAIL");
    expect(result.groups.P2.fails.join()).toContain("noPartialEntries");
  });
  it("an exception stops that group and every later group is INCONCLUSIVE (NOT_RUN), not PASS", async () => {
    let n = 0;
    const result = await fullRun({
      deps: {
        api: async (method, url, body) => {
          if (url.startsWith("/api/production-entries/day/") && ++n === 8) throw new Error("socket hang up");
          const res = await send(method, url, owner.cookie, body);
          return { status: res.status, body: res.body };
        },
      },
    });
    expect(result.verdict).not.toBe("PASS");
    const stopped = GROUPS.filter((g) => result.groups[g].stopped);
    expect(stopped.length).toBeGreaterThan(1);
    expect(result.groups[stopped.at(-1)].stopped).toMatch(/NOT_RUN|STOPPED/);
    expect(formatReport(result).join("\n")).toContain("NOT RUN:");
  });
  it("a group with a missing required check is INCONCLUSIVE; failures outrank it", () => {
    const g = { checks: Object.fromEntries(REQUIRED.P1.slice(1).map((n) => [n, true])), fails: [], notes: [], stopped: null };
    expect(groupVerdict("P1", g)).toBe("INCONCLUSIVE");
    expect(groupVerdict("P1", { ...g, fails: ["x"] })).toBe("FAIL");
    expect(overall({ ...Object.fromEntries(Object.keys(REQUIRED).map((n) => [n, { checks: Object.fromEntries(REQUIRED[n].map((c) => [c, true])), fails: [], stopped: null }])), P1: g })).toBe("INCONCLUSIVE");
  });
  it("preflight lists labours; if a created id were among them the run stops (teamIdsNew)", async () => {
    const approved = await runPreflight(makeReadDeps(), { base: BASE });
    // Claim that every id the counter will hand out already existed
    const fake = { ...approved, existingLabourIds: ["L-001", "L-002", "L-003", "L-004", "L-005", "L-006", "L-007"] };
    const result = await runPatlavale(makeDeps(), { approved: fake, mode: "MOCKED" });
    expect(result.verdict).not.toBe("PASS");
    expect(result.groups.FIXTURES.fails.join()).toContain("teamIdsNew");
    expect(result.groups.P1.stopped).toMatch(/NOT_RUN/);
  });
});

describe("T: transaction, rollback and a real conflict", () => {
  it("rival commits first; the batch answers 409 with nothing else saved; control commits whole", async () => {
    const result = await fullRun();
    const t = result.groups.T;
    expect(Object.values(t.checks).every(Boolean), JSON.stringify(t.fails)).toBe(true);
    expect(txn.attempts).toBeGreaterThanOrEqual(2);
    const raceRows = [...db.production.values()].filter((r) => r.date === planDates(BASE).t.race);
    expect(raceRows).toHaveLength(1);
    expect(raceRows[0].numberOfMaaps).toBe(9);
    expect(raceRows[0].revision).toBe(2);
    expect(FakeProduction.updateOne).toBe(emulatedUpdateOne); // hook restored
  });
  it.each([[0], [1]])("a transient WriteConflict budget of %i still ends in 409 and the same final state", async (budget) => {
    txn.budget = budget;
    const result = await fullRun();
    expect(result.verdict).toBe("PASS");
    expect(txn.budget).toBe(0);
  });
  it("more retries than the bound (budget 3 -> 8 write ops, wrong sequence) is FAIL, not PASS", async () => {
    txn.budget = 3;
    const result = await fullRun();
    expect(result.groups.T.fails.join()).toMatch(/opSequence/);
    expect(result.verdict).toBe("FAIL");
    expect(MAX_TRANSACTION_OPS).toBe(8);
  });
  it("if the rival never fires, T is not PASS", async () => {
    const result = await fullRun({
      deps: {
        ProductionEntry: new Proxy(FakeProduction, { set: () => true }), // the hook cannot be installed
      },
    });
    expect(result.groups.T.checks.rivalFiredOnce).toBe(false);
    expect(result.verdict).not.toBe("PASS");
  });
  it("the hook is restored even when the batch request throws", async () => {
    let calls = 0;
    const result = await fullRun({
      deps: {
        api: async (method, url, body) => {
          if (url.startsWith(`/api/production-entries/day/${planDates(BASE).t.race}`) && ++calls === 2) throw new Error("boom");
          const res = await send(method, url, owner.cookie, body);
          return { status: res.status, body: res.body };
        },
      },
    });
    expect(FakeProduction.updateOne).toBe(emulatedUpdateOne);
    expect(result.verdict).not.toBe("PASS");
  });
});

describe("rules the harness asserts match the real production code", () => {
  it("the independent calculation agrees with the production helpers for many maap counts and rates", () => {
    for (const rate of [1, 3, 70000, 70002, 80000, 99999, 123457]) {
      for (let maaps = 0; maaps <= 200; maaps += 1) {
        expect(H.expectedEarningsPaise(maaps, rate)).toBe(money.earningsPaiseForMaaps(maaps, rate));
        const c = calculateProduction(maaps, rate);
        expect([c.payableBricks, c.physicalBricks, c.earningsPaise]).toEqual([H.expectedPayable(maaps), H.expectedPhysical(maaps), H.expectedEarningsPaise(maaps, rate)]);
      }
    }
  });
  it("the table of the task (at 700 per 1,000 payable bricks)", () => {
    const table = { 1: [250, 275, 17500], 3: [750, 825, 52500], 4: [1000, 1100, 70000], 5: [1250, 1375, 87500], 10: [2500, 2750, 175000] };
    for (const [m, [p, ph, e]] of Object.entries(table)) expect([H.expectedPayable(+m), H.expectedPhysical(+m), H.expectedEarningsPaise(+m, 70000)]).toEqual([p, ph, e]);
  });
  it("the rounding-boundary rate really is a half-paise case", () => {
    expect(money.rupeesToPaise(FIXTURE.teams.E.rate)).toBe(70002);
    expect((1 * 70002) % 4).toBe(2);
    expect((3 * 70002) % 4).toBe(2);
  });
  it("the production source files really do not depend on payments, and the check bites on a mutant", async () => {
    for (const f of ["services/productionEntry.service.js", "services/productionCalculations.js", "services/season.service.js", "models/ProductionEntry.js"]) {
      const text = stripComments(readFileSync(path.join(serverDir, f), "utf8"));
      expect(PAYMENT_DEPENDENCY.test(text), f).toBe(false);
    }
    const original = readFileSync(path.join(serverDir, "services/productionEntry.service.js"), "utf8");
    for (const mutant of [`import Payment from "../models/Payment.js";\n${original}`, `import { x } from "./salary.service.js";\n${original}`, `${original}\nconst p = await Payment.find({});`]) {
      expect(PAYMENT_DEPENDENCY.test(stripComments(mutant))).toBe(true);
    }
    expect(PAYMENT_DEPENDENCY.test(stripComments("// Payments are never read here\n/* Payment */ const a = 1;"))).toBe(false);
  });
  it("a source file that starts depending on payments makes P5 FAIL", async () => {
    const result = await fullRun({ deps: { readSource: async (f) => (f.endsWith("season.service.js") ? `import Payment from "../models/Payment.js";\n` : readFile(path.join(serverDir, f), "utf8")) } });
    expect(result.groups.P5.fails.join()).toContain("sourceIndependentOfPayments");
    expect(result.verdict).toBe("FAIL");
  });
  it("the planned dates are distinct, inside the window, and the season layout cannot overlap", () => {
    const p = planDates(BASE);
    expect(p.windowEnd).toBe("2025-05-20");
    expect(p.s1.endDate < p.s2.startDate).toBe(true);
    const used = [...p.p1, ...p.round, p.p2.day, p.p2.invalid, p.p2.other, p.p3.before, p.p3.later, p.p3.rateChange, p.p3.after, p.p4.move, p.p4.target, p.p5.closedOpenDay, p.p5.closedTry, p.p5.payment, p.t.race, p.t.control];
    expect(new Set(used).size).toBe(used.length);
    for (const d of used.filter((x) => x !== p.p5.closedOpenDay && x !== p.p5.closedTry && x !== p.p5.payment)) expect(d >= p.s1.startDate && d <= p.s1.endDate, d).toBe(true);
    expect(p.p5.noSeason > p.s2.endDate && p.p5.noSeason <= p.windowEnd).toBe(true);
    expect(p.p5.beforeJoining < p.joining).toBe(true);
    expect(p.joining < p.base).toBe(true);
  });
});

describe("Atlas guards (pure)", () => {
  const good = {
    argv: ["--mode", "atlas", "--confirm-db", EXPECTED_DB, "--confirm-host", EXPECTED_CLUSTER_HOST, "--i-understand-this-writes-test-data"],
    env: { MONGODB_URI: `mongodb+srv://someuser:S3cretPw@${EXPECTED_CLUSTER_HOST}/${EXPECTED_DB}?retryWrites=true`, OWNER_EMAIL: "o@example.com", OWNER_PASSWORD: "ownerSecretPw" },
  };
  const without = (flag) => ({ ...good, argv: good.argv.filter((a, i, arr) => a !== flag && arr[i - 1] !== flag) });
  it("accepts the full, correct set", () => {
    const g = checkAtlasGuards(good);
    expect(g).toMatchObject({ ok: true, dbName: EXPECTED_DB, host: EXPECTED_CLUSTER_HOST, base: "2025-03-01" });
  });
  it("refuses each missing piece", () => {
    for (const flag of ["--mode", "--i-understand-this-writes-test-data", "--confirm-db", "--confirm-host"]) expect(checkAtlasGuards(without(flag)).ok, flag).toBe(false);
    expect(checkAtlasGuards({ ...good, argv: ["--mode", "mocked", ...good.argv.slice(2)] }).ok).toBe(false);
    expect(checkAtlasGuards({ ...good, env: { ...good.env, OWNER_PASSWORD: "" } }).ok).toBe(false);
    expect(checkAtlasGuards({ ...good, env: { ...good.env, OWNER_EMAIL: undefined } }).ok).toBe(false);
  });
  it("refuses production NODE_ENV", () => {
    expect(checkAtlasGuards({ ...good, env: { ...good.env, NODE_ENV: "Production" } }).problem).toMatch(/production/);
  });
  it("refuses the wrong database, even when it ends in _test and is confirmed", () => {
    const env = { ...good.env, MONGODB_URI: `mongodb+srv://u:p@${EXPECTED_CLUSTER_HOST}/other_test` };
    expect(checkAtlasGuards({ argv: good.argv.map((a) => (a === EXPECTED_DB ? "other_test" : a)), env }).ok).toBe(false);
    expect(checkAtlasGuards({ ...good, env: { ...good.env, MONGODB_URI: `mongodb+srv://u:p@${EXPECTED_CLUSTER_HOST}/aayush_carting` } }).ok).toBe(false);
    expect(checkAtlasGuards({ ...good, env: { ...good.env, MONGODB_URI: `mongodb+srv://u:p@${EXPECTED_CLUSTER_HOST}/` } }).ok).toBe(false);
    expect(checkAtlasGuards({ ...good, argv: good.argv.map((a) => (a === EXPECTED_DB ? "aayush_carting" : a)) }).ok).toBe(false);
  });
  it("the database name alone is not enough: another cluster with the right db name is refused", () => {
    for (const host of ["other-cluster.abc123.mongodb.net", "evil.example.com", "localhost:27017", `x.${EXPECTED_CLUSTER_HOST}.evil.com`, "aayush-carting.7xmegwh.mongodb.net.evil.com"]) {
      const r = checkAtlasGuards({ ...good, env: { ...good.env, MONGODB_URI: `mongodb+srv://u:p@${host}/${EXPECTED_DB}` } });
      expect(r.ok, host).toBe(false);
      expect(r.problem).toMatch(/not the confirmed TEST cluster/);
    }
    // credentials in the URI must never be mistaken for the host
    expect(checkAtlasGuards({ ...good, env: { ...good.env, MONGODB_URI: `mongodb+srv://${EXPECTED_CLUSTER_HOST}:pw@evil.example.com/${EXPECTED_DB}` } }).ok).toBe(false);
  });
  it("a different --confirm-host is refused; a shard host of the same cluster is accepted when the cluster is confirmed", () => {
    expect(checkAtlasGuards({ ...good, argv: good.argv.map((a) => (a === EXPECTED_CLUSTER_HOST ? "other.mongodb.net" : a)) }).ok).toBe(false);
    const shard = "ac-abc-shard-00-00.7xmegwh.mongodb.net:27017,ac-abc-shard-00-01.7xmegwh.mongodb.net:27017";
    expect(checkAtlasGuards({ ...good, env: { ...good.env, MONGODB_URI: `mongodb://u:p@${shard}/${EXPECTED_DB}?ssl=true` } }).ok).toBe(true);
    expect(checkAtlasGuards({ ...good, env: { ...good.env, MONGODB_URI: `mongodb://u:p@${shard},evil.example.com:27017/${EXPECTED_DB}` } }).ok).toBe(false);
  });
  it("a bad --window-start is refused", () => {
    expect(checkAtlasGuards({ ...good, argv: [...good.argv, "--window-start", "2025-02-30"] }).ok).toBe(false);
    expect(checkAtlasGuards({ ...good, argv: [...good.argv, "--window-start", "2024-06-01"] })).toMatchObject({ ok: true, base: "2024-06-01" });
  });
  it("no refusal message ever contains the password, the user name, or the connection string", () => {
    const variants = [without("--mode"), without("--confirm-db"), without("--confirm-host"), { ...good, env: { ...good.env, NODE_ENV: "production" } }, { ...good, env: { ...good.env, MONGODB_URI: `mongodb+srv://someuser:S3cretPw@evil.example.com/${EXPECTED_DB}` } }, { ...good, env: { ...good.env, MONGODB_URI: "mongodb+srv://someuser:S3cretPw@x.mongodb.net/db_a" } }];
    for (const v of variants) {
      const r = checkAtlasGuards(v);
      expect(r.ok).toBe(false);
      for (const secret of ["S3cretPw", "someuser", "ownerSecretPw", "mongodb+srv://"]) expect(r.problem).not.toContain(secret);
    }
  });
  it("the live connection must be the TEST database on the confirmed cluster", () => {
    expect(liveConnectionProblem({ liveName: EXPECTED_DB, liveHost: EXPECTED_CLUSTER_HOST })).toBeNull();
    expect(liveConnectionProblem({ liveName: EXPECTED_DB, liveHost: "ac-abc-shard-00-00.7xmegwh.mongodb.net" })).toBeNull();
    expect(liveConnectionProblem({ liveName: "aayush_carting", liveHost: EXPECTED_CLUSTER_HOST })).toMatch(/not "aayush_carting_test"|not "aayush_carting_test"/);
    expect(liveConnectionProblem({ liveName: EXPECTED_DB, liveHost: "other.abc.mongodb.net" })).toMatch(/not part of the confirmed cluster/);
    expect(liveConnectionProblem({ liveName: EXPECTED_DB, liveHost: undefined })).toMatch(/not part of the confirmed cluster/);
  });
  it("index safety: autoIndex / autoCreate must both be off", () => {
    const m = { settings: { autoIndex: true, autoCreate: true }, get(k) { return this.settings[k]; }, set(k, v) { this.settings[k] = v; } };
    expect(indexSafetyProblem(m)).toMatch(/autoIndex and autoCreate/);
    expect(applyIndexSafety(m)).toBeNull();
    const stubborn = { get: () => true, set: () => {} };
    expect(applyIndexSafety(stubborn)).toMatch(/Refusing/);
  });
  it("shutdownServer closes a listener even with a stuck request", async () => {
    const http = await import("node:http");
    const server = http.createServer(() => {});
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const port = server.address().port;
    const req = http.request({ port, host: "127.0.0.1", method: "GET", path: "/" });
    req.on("error", () => {});
    req.end();
    await new Promise((r) => setTimeout(r, 30));
    await shutdownServer(server);
    expect(server.listening).toBe(false);
    await shutdownServer(undefined);
  });
});

describe("the Atlas runner (verifyPatlavale.js): static order and child-process refusals", () => {
  const runner = readFileSync(path.join(serverDir, "scripts/verifyPatlavale.js"), "utf8");
  const code = stripComments(runner);
  const spawn = (args, env = {}) => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "patl-"));
    return spawnSync(process.execPath, [path.join(serverDir, "scripts/verifyPatlavale.js"), ...args], {
      cwd,
      env: { PATH: process.env.PATH, NODE_ENV: "test", ...env },
      encoding: "utf8",
      timeout: 20000,
    });
  };
  const SECRET_URI = `mongodb+srv://dummyuser:DummyPw123@${EXPECTED_CLUSTER_HOST}/${EXPECTED_DB}`;
  it("static imports are only dotenv, node built-ins and the harness; everything that can connect is imported after the guards", () => {
    const staticImports = [...code.matchAll(/^import\s.*?from\s+"([^"]+)";/gm)].map((m) => m[1]);
    expect(staticImports).toEqual(["dotenv", "node:http", "node:fs/promises", "node:url", "node:path", "./lib/patlavaleHarness.js"]);
    const at = (needle) => code.indexOf(needle);
    expect(at("checkAtlasGuards({")).toBeGreaterThan(0);
    expect(at("await import(\"mongoose\")")).toBeGreaterThan(at("checkAtlasGuards({"));
    expect(at("await import(\"../config/db.js\")")).toBeGreaterThan(at("checkAtlasGuards({"));
    expect(at("applyIndexSafety(mongoose)")).toBeGreaterThan(at("await import(\"../config/db.js\")"));
    expect(at("await connectDB(")).toBeGreaterThan(at("applyIndexSafety(mongoose)"));
    expect(at("liveConnectionProblem(")).toBeGreaterThan(at("await connectDB("));
    for (const model of ["ProductionEntry", "Labour", "LabourRateHistory", "Season", "Payment"]) expect(at(`await import("../models/${model}.js")`)).toBeGreaterThan(at("liveConnectionProblem("));
    expect(at("await import(\"../app.js\")")).toBeGreaterThan(at("const startAndLogin")); // only inside the callback that runGuarded calls after the preflight
    expect(at("await import(\"../app.js\")")).toBeLessThan(at("await runGuarded({"));
    expect(code.match(/import\("\.\.\/app\.js"\)/g)).toHaveLength(1);
    expect(code.indexOf("api/auth/login")).toBeGreaterThan(at("const startAndLogin"));
  });
  it("the runner only READS through native collections and the harness never uses a native write or delete", () => {
    const natives = [...code.matchAll(/\.collection\.(\w+)\(/g)].map((m) => m[1]);
    expect(natives.length).toBeGreaterThan(0);
    expect(new Set(natives)).toEqual(new Set(["find"]));
    const harness = stripComments(readFileSync(path.join(serverDir, "scripts/lib/patlavaleHarness.js"), "utf8"));
    for (const word of ["deleteOne", "deleteMany", "insertOne", "insertMany", "bulkWrite", "updateMany", "replaceOne", "findOneAndDelete", ".drop(", "dropDatabase", "syncIndexes", "createIndex"]) {
      expect(harness.includes(word), `harness: ${word}`).toBe(false);
      expect(code.includes(word), `runner: ${word}`).toBe(false);
    }
    const deletes = [...harness.matchAll(/api\("delete",\s*`([^`]+)`/g)].map((m) => m[1]);
    expect(deletes.length).toBeGreaterThan(0);
    for (const d of deletes) expect(d).toMatch(/^\/api\/production-entries\/\$\{idOf\(/);
  });
  it("--mode mocked prints the hint and exits 0 without loading mongoose", () => {
    const r = spawn(["--mode", "mocked"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("npx vitest run tests/patlavaleHarness.test.js");
  });
  it.each([
    ["no arguments", [], {}],
    ["no confirm flags", ["--mode", "atlas"], { MONGODB_URI: SECRET_URI }],
    ["wrong cluster", ["--mode", "atlas", "--confirm-db", EXPECTED_DB, "--confirm-host", EXPECTED_CLUSTER_HOST, "--i-understand-this-writes-test-data"], { MONGODB_URI: `mongodb+srv://dummyuser:DummyPw123@other.abc123.mongodb.net/${EXPECTED_DB}`, OWNER_EMAIL: "a@b.c", OWNER_PASSWORD: "DummyOwnerPw" }],
    ["production", ["--mode", "atlas", "--confirm-db", EXPECTED_DB, "--confirm-host", EXPECTED_CLUSTER_HOST, "--i-understand-this-writes-test-data"], { NODE_ENV: "production", MONGODB_URI: SECRET_URI, OWNER_EMAIL: "a@b.c", OWNER_PASSWORD: "DummyOwnerPw" }],
    ["no owner credentials", ["--mode", "atlas", "--confirm-db", EXPECTED_DB, "--confirm-host", EXPECTED_CLUSTER_HOST, "--i-understand-this-writes-test-data"], { MONGODB_URI: SECRET_URI }],
  ])("refuses with exit 2 before anything loads: %s (no secret printed)", (_label, args, env) => {
    const r = spawn(args, env);
    expect(r.status).toBe(2);
    const out = `${r.stdout}${r.stderr}`;
    for (const secret of ["DummyPw123", "dummyuser", "DummyOwnerPw", "mongodb+srv://"]) expect(out).not.toContain(secret);
    expect(out).not.toContain("Target database");
  });
});
