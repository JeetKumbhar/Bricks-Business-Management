import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import mongoose from "mongoose";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.NODE_ENV = "test";
  process.env.BCRYPT_ROUNDS = "4";
  process.env.CLIENT_ORIGIN = "http://localhost:5173";
  process.env.JWT_SECRET = "unit-test-secret-that-is-long-enough-0123456789";
});

// Phase 1C Stage 4, step 1. FAKE-DATABASE tests only: they prove the harness's guards, gates and scenario logic. The in-memory store has no
// snapshot isolation and no WriteConflict, so NOTHING here proves real MongoDB behaviour. No database connection is ever made.
const { db, matches, makeAttendanceModel, makeBillModel, makeCounterModel, makeInvoiceSettingsModel, makeLabourModel, makeMaapEntryModel, makePaymentModel, makeProductionEntryModel, makeRateModel, makeSeasonModel, makeTruckHistoryModel, makeTruckModel, makeTruckTripModel } = await import("./helpers/memoryDb.js");

vi.mock("../config/db.js", () => ({ getDbStatus: async () => ({ status: "connected", name: "test" }) }));
vi.mock("../models/User.js", () => ({ default: { findById: () => ({ lean: async () => null }) } }));
vi.mock("../models/Counter.js", () => ({ default: makeCounterModel() }));
vi.mock("../models/Labour.js", async (importOriginal) => ({ default: makeLabourModel((await importOriginal()).default) }));
vi.mock("../models/LabourRateHistory.js", async (importOriginal) => ({ default: makeRateModel((await importOriginal()).default) }));
vi.mock("../models/Attendance.js", () => ({ default: makeAttendanceModel() }));
vi.mock("../models/MaapEntry.js", () => ({ default: makeMaapEntryModel() }));
vi.mock("../models/Season.js", async (importOriginal) => ({ default: makeSeasonModel((await importOriginal()).default) }));
vi.mock("../models/ProductionEntry.js", () => ({ default: makeProductionEntryModel() }));
vi.mock("../models/Payment.js", async (importOriginal) => ({ default: makePaymentModel((await importOriginal()).default) }));
vi.mock("../models/Truck.js", async (importOriginal) => ({ default: makeTruckModel((await importOriginal()).default) }));
vi.mock("../models/TruckStatusHistory.js", async (importOriginal) => ({ default: makeTruckHistoryModel((await importOriginal()).default) }));
vi.mock("../models/TruckTrip.js", async (importOriginal) => ({ default: makeTruckTripModel((await importOriginal()).default) }));
vi.mock("../models/Bill.js", async (importOriginal) => ({ default: makeBillModel((await importOriginal()).default) }));
vi.mock("../models/InvoiceSettings.js", async (importOriginal) => ({ default: makeInvoiceSettingsModel((await importOriginal()).default) }));
vi.mock("../utils/transaction.js", () => ({ runInTransaction: async (work) => db.transaction(() => work(null)) }));

const H = await import("../scripts/lib/phase1cHarness.js");
const { EXPECTED_CLUSTER_HOST, EXPECTED_DB } = await import("../scripts/lib/patlavaleHarness.js");
const { todayBusinessDate } = await import("../utils/dates.js");
const services = {
  labour: await import("../services/labour.service.js"),
  attendance: await import("../services/attendance.service.js"),
  season: await import("../services/season.service.js"),
  maap: await import("../services/maapEntry.service.js"),
  payment: await import("../services/payment.service.js"),
  production: await import("../services/productionEntry.service.js"),
  bill: await import("../services/bill.service.js"),
  invoiceSettings: await import("../services/invoiceSettings.service.js"),
  salary: await import("../services/salary.service.js"),
  balance: await import("../services/balance.service.js"),
};

const today = todayBusinessDate();
const OWNER = { id: null, name: "Owner" };
const clone = (x) => JSON.parse(JSON.stringify(x));
const stores = {
  labours: () => [...db.labours.values()], rates: () => db.rates, attendance: () => [...db.attendance.values()], maap: () => [...db.maap.values()],
  production: () => [...db.production.values()], payments: () => [...db.payments.values()], seasons: () => [...db.seasons.values()], bills: () => [...db.bills.values()],
  settings: () => [...db.invoiceSettings.values()], counters: () => Object.entries(db.counters).map(([k, v]) => ({ _id: k, seq: v })),
};
const read = async (name, filter = {}) => clone(stores[name]().filter((r) => matches(r, filter)));
// STRICT native-driver view: ObjectId-backed collections return real BSON ObjectId `_id` values and, like the real driver, a hex STRING never matches them.
const OID = mongoose.Types.ObjectId;
const toObjectId = (hex) => new OID(hex);
const IDS = ["rates", "attendance", "maap", "production", "payments", "seasons", "bills"];
const idHit = (rowId, cond) => {
  const one = (c) => (rowId instanceof OID ? c instanceof OID && c.equals(rowId) : c === rowId);
  if (cond && typeof cond === "object" && !(cond instanceof OID)) return "$in" in cond ? cond.$in.some(one) : "$ne" in cond ? !one(cond.$ne) : false;
  return one(cond);
};
const nativeRead = async (name, filter = {}) => {
  const { _id, ...rest } = filter;
  return clone(stores[name]().filter((r) => matches(r, rest)))
    .map((r) => (IDS.includes(name) && /^[0-9a-f]{24}$/i.test(String(r._id)) ? { ...r, _id: new OID(r._id) } : r))
    .filter((r) => _id === undefined || idHit(r._id, _id));
};
const snapshot = () => JSON.stringify([...Object.keys(stores)].map((k) => stores[k]())) + JSON.stringify(db.counters);
const deps = (extra = {}) => ({
  services, read: nativeRead, toObjectId, today, runId: "R1", runNumber: 1, settingsId: "default", probeTransaction: async () => ({}),
  insertLegacyLabour: async (doc) => db.labours.set(doc._id, { ...doc, statusHistory: [{ status: "ACTIVE", at: new Date(), by: "x", reason: "legacy" }], createdAt: new Date(), updatedAt: new Date() }),
  ...extra,
});
const seller = { businessName: "AAYUSH CARTING", businessDescription: "BUILDING MATERIAL SUPPLIER", productsLine: "BRICKS", address: "Sample Road", phones: ["9800000001"], jurisdiction: "Sample", stateName: "Sample State", stateCode: "27", gstin: "27ABCDE1234F1Z5", pan: "ABCDE1234F", bank: { bankName: "Sample Bank", branch: "Main", accountNumber: "1234567890", ifsc: "SAMP0000001" }, proprietorName: "Ramesh Patel" };
const configureSeller = () => services.invoiceSettings.updateSettings(seller, OWNER);
const run = (phase, flags = {}, d = deps()) => H.runPhase(phase, d, { windowStart: "2001-03-01", flags });
const byId = (r, id) => r.results.find((x) => x.id === id);
const statuses = (r) => Object.fromEntries(r.results.map((x) => [x.id, x.status]));

beforeEach(() => db.reset());

// ---------------------------------------------------------------------------------------------------------------------------------
const URI = `mongodb+srv://someuser:SECRETPASS@${EXPECTED_CLUSTER_HOST}/${EXPECTED_DB}?retryWrites=true`;
const env = (o = {}) => ({ MONGODB_URI: URI, NODE_ENV: "development", ...o });
const base = ["--confirm-db", EXPECTED_DB, "--confirm-host", EXPECTED_CLUSTER_HOST];
const W = "--i-understand-this-writes-test-data";
const guard = (argv, e = env()) => H.checkGuards({ argv, env: e, today });

describe("guards", () => {
  it("accepts a read-only precheck and each write phase with its flags", () => {
    expect(guard(["--phase", "precheck", ...base])).toMatchObject({ ok: true, phase: "precheck", writes: false, windowStart: "2001-03-01" });
    for (const p of ["d1", "d2", "p6"]) expect(guard(["--phase", p, W, ...base])).toMatchObject({ ok: true, writes: true });
    expect(guard(["--phase", "p3", W, "--accept-permanent-numbering-lock", "--accept-numbering-race", ...base]).flags).toMatchObject({ permanentLock: true, numberingRace: true });
    expect(guard(["--phase", "d2", W, "--allow-direct-fixture-insert", ...base]).flags.directInsert).toBe(true);
  });
  const refused = [
    ["no phase", [...base]],
    ["unknown phase", ["--phase", "all", ...base]],
    ["unknown option", ["--phase", "precheck", "--fast", ...base]],
    ["stray argument", ["--phase", "precheck", "extra", ...base]],
    ["duplicate option", ["--phase", "precheck", "--phase", "d1", ...base]],
    ["option without value", ["--phase", "precheck", "--confirm-db"]],
    ["missing --confirm-db", ["--phase", "precheck", "--confirm-host", EXPECTED_CLUSTER_HOST]],
    ["wrong --confirm-db", ["--phase", "precheck", "--confirm-db", "aayush_carting", "--confirm-host", EXPECTED_CLUSTER_HOST]],
    ["missing --confirm-host", ["--phase", "precheck", "--confirm-db", EXPECTED_DB]],
    ["wrong --confirm-host", ["--phase", "precheck", "--confirm-db", EXPECTED_DB, "--confirm-host", "other.mongodb.net"]],
    ["write phase without the write flag", ["--phase", "d1", ...base]],
    ["p3 without the permanent-lock flag", ["--phase", "p3", W, ...base]],
    ["write flag on the precheck", ["--phase", "precheck", W, ...base]],
    ["lock flag on the precheck", ["--phase", "precheck", "--accept-permanent-numbering-lock", ...base]],
    ["race flag outside p3", ["--phase", "d1", W, "--accept-numbering-race", ...base]],
    ["rerun flag on the precheck", ["--phase", "precheck", "--allow-rerun", ...base]],
    ["direct-insert flag outside d2", ["--phase", "p6", W, "--allow-direct-fixture-insert", ...base]],
    ["window not a date", ["--phase", "d1", W, "--window-start", "2001-02-30", ...base]],
    ["window too recent", ["--phase", "d1", W, "--window-start", today, ...base]],
  ];
  for (const [name, argv] of refused) it(`refuses: ${name}`, () => expect(guard(argv)).toMatchObject({ ok: false, problem: expect.stringMatching(/^Refusing:/) }));
  it("--allow-rerun is accepted on write phases only", () => {
    expect(guard(["--phase", "d1", W, "--allow-rerun", ...base]).flags.allowRerun).toBe(true);
    expect(guard(["--phase", "d1", W, ...base]).flags.allowRerun).toBe(false);
  });
  it("refuses a wrong database name, a wrong host, a missing URI and production", () => {
    const argv = ["--phase", "precheck", ...base];
    expect(guard(argv, env({ MONGODB_URI: URI.replace(EXPECTED_DB, "aayush_carting") })).ok).toBe(false);
    expect(guard(argv, env({ MONGODB_URI: URI.replace(EXPECTED_CLUSTER_HOST, "evil.example.com") })).ok).toBe(false);
    expect(guard(argv, env({ MONGODB_URI: `mongodb://u:p@${EXPECTED_CLUSTER_HOST}` })).ok).toBe(false);
    expect(guard(argv, env({ MONGODB_URI: undefined })).ok).toBe(false);
    expect(guard(argv, env({ NODE_ENV: "production" })).ok).toBe(false);
  });
  it("never echoes the connection string or password in any refusal", () => {
    const bad = [guard(["--phase", "precheck"]), guard(["--phase", "precheck", ...base], env({ MONGODB_URI: URI.replace(EXPECTED_DB, "other") })), guard(["--phase", "precheck", ...base], env({ MONGODB_URI: URI.replace(EXPECTED_CLUSTER_HOST, "evil.example.com") }))];
    for (const g of bad) expect(g.problem).not.toMatch(/SECRETPASS|someuser|mongodb(\+srv)?:\/\//i);
  });
  it("a custom --window-start is honoured when it is far enough in the past", () => {
    expect(guard(["--phase", "d1", W, "--window-start", "1999-01-01", ...base]).windowStart).toBe("1999-01-01");
  });
});

describe("script: runs the guards before anything else, and refuses without connecting", () => {
  const spawn = (args, e) => spawnSync(process.execPath, ["scripts/verifyPhase1C.js", ...args], { cwd: new URL("..", import.meta.url).pathname, env: { PATH: process.env.PATH, ...e }, encoding: "utf8", timeout: 20000 });
  it("exits 2 with no arguments and with a wrong database, without printing credentials", () => {
    const a = spawn([], {});
    expect(a.status).toBe(2);
    const b = spawn(["--phase", "precheck", ...base], { MONGODB_URI: "mongodb+srv://user:SECRETPASS@evil.example.com/aayush_carting?x=1" });
    expect(b.status).toBe(2);
    expect(b.stdout + b.stderr).not.toMatch(/SECRETPASS|user:/);
  });
  it("source order: guards, then mongoose, then index safety, then connect; the live connection is re-checked", () => {
    const s = readFileSync(new URL("../scripts/verifyPhase1C.js", import.meta.url), "utf8");
    const at = (t) => s.indexOf(t);
    expect(at("checkGuards(")).toBeGreaterThan(-1);
    expect(at("checkGuards(")).toBeLessThan(at('import("mongoose")'));
    expect(at("applyIndexSafety(mongoose)")).toBeLessThan(at("connectDB("));
    expect(at("connectDB(")).toBeLessThan(at("liveConnectionProblem("));
    expect(at("liveConnectionProblem(")).toBeLessThan(at('import("../models/'));
    expect(at("liveConnectionProblem(")).toBeLessThan(at('import("../services/'));
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
describe("static safety: what the harness and the script can do", () => {
  const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\/\/ .*$/gm, "").replace(/'[^']*'|"[^"]*"|`[^`]*`/g, '""');
  const lib = strip(readFileSync(new URL("../scripts/lib/phase1cHarness.js", import.meta.url), "utf8"));
  const script = strip(readFileSync(new URL("../scripts/verifyPhase1C.js", import.meta.url), "utf8"));
  const FORBIDDEN = /\b(deleteOne|deleteMany|remove|drop|dropIndex|dropIndexes|dropDatabase|dropCollection|createIndex|createIndexes|syncIndexes|ensureIndexes|updateMany|updateOne|replaceOne|bulkWrite|insertMany|findOneAndUpdate|findOneAndDelete|findOneAndReplace|rename|\$unset|\$rename)\b/;
  it("the harness library has no delete, drop, index or bulk-write call and imports no model, driver or service", () => {
    expect(lib).not.toMatch(FORBIDDEN);
    const raw = readFileSync(new URL("../scripts/lib/phase1cHarness.js", import.meta.url), "utf8");
    expect([...raw.matchAll(/^import .* from "([^"]+)"/gm)].map((m) => m[1])).toEqual(["./patlavaleHarness.js"]);
  });
  it("the script has no delete, drop, index, bulk or update call, and exactly one insert (the gated d2 fixture)", () => {
    expect(script).not.toMatch(FORBIDDEN);
    expect(script.match(/\binsertOne\b/g)).toHaveLength(1);
    expect(readFileSync(new URL("../scripts/verifyPhase1C.js", import.meta.url), "utf8")).toMatch(/collection\.find\(filter\)\.toArray\(\)/);
  });
  it("the script wires the two extra services and prints each record as it is created", () => {
    const raw = readFileSync(new URL("../scripts/verifyPhase1C.js", import.meta.url), "utf8");
    expect(raw).toMatch(/services\/maapEntry\.service\.js/);
    expect(raw).toMatch(/services\/payment\.service\.js/);
    expect(raw).toMatch(/onRecord:/);
  });
  it("existing scripts and application code are untouched by this step (no references added to them)", () => {
    for (const f of ["../scripts/verifyPatlavale.js", "../scripts/verifyRace.js", "../scripts/syncIndexes.js", "../scripts/censusHistorical.js"]) expect(readFileSync(new URL(f, import.meta.url), "utf8")).not.toMatch(/phase1cHarness|verifyPhase1C/);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
describe("service gate and reader gate", () => {
  it("a read-only run exposes every write method as a stub that throws WriteRefused and writes nothing", async () => {
    await configureSeller();
    const before = snapshot();
    const gated = H.gateServices(services, { allowWrites: false });
    for (const [group, { write }] of Object.entries(H.SERVICE_METHODS)) for (const name of write) expect(() => gated[group][name]({})).toThrow(H.WriteRefused);
    expect(snapshot()).toBe(before);
  });
  it("only classified methods are exposed: an unclassified service function does not exist on the gated object", () => {
    const gated = H.gateServices({ labour: { ...services.labour, deleteEverything: () => 1 } }, { allowWrites: true });
    expect(gated.labour.deleteEverything).toBeUndefined();
    expect(Object.keys(gated.labour).sort()).toEqual(["createLabour", "getLabour", "getLabourSummary", "nextLabourId", "updateLabour"]);
    expect(Object.isFrozen(gated)).toBe(true);
  });
  it("read methods work in a read-only run", async () => {
    const gated = H.gateServices(services, { allowWrites: false });
    expect((await gated.salary.getSalarySummary()).items).toEqual([]);
    expect((await gated.invoiceSettings.loadSettings()).numbering).toBeTruthy();
  });
  it("the reader refuses collections outside the whitelist", async () => {
    const r = H.gateRead(read, toObjectId);
    expect(await r("labours")).toEqual([]);
    await expect(r("users")).rejects.toThrow(/not allowed/);
    await expect(r("system.indexes")).rejects.toThrow(/not allowed/);
  });
  it("the direct fixture insert needs the d2 phase, the flag, an id RESERVED in this run through the app's allocator, a fixture-shaped name, and a Bigari", async () => {
    const inserted = [];
    const d = deps({ insertLegacyLabour: async (doc) => inserted.push(doc) });
    const attempt = async (phase, flags, patch = {}, { reserve = true } = {}) => {
      try {
        const ctx = H.makeContext(phase, d, { windowStart: "2001-03-01", flags });
        const id = reserve ? await ctx.reserveLabourId() : "L-500";
        await ctx.insertLegacyLabour({ _id: id, labourType: "BIGARI", name: `${H.FIXTURE.prefix} R1 D2-NORATE`, mobile: "9009000112", village: "ZZ", joiningDate: "2001-03-11", status: "ACTIVE", ...patch });
        return "PASS";
      } catch (e) {
        return e.name;
      }
    };
    db.counters.labour = 19;
    expect(await attempt("d2", { directInsert: true })).toBe("PASS");
    expect(inserted[0]._id).toBe("L-020"); // the app's allocator handed out the next number
    expect(db.counters.labour).toBe(20);
    expect(await attempt("d2", {})).toBe("WriteRefused");
    expect(await attempt("d1", { directInsert: true })).toBe("WriteRefused");
    expect(await attempt("d2", { directInsert: true }, { _id: "L-001" })).toBe("WriteRefused"); // not the reserved id
    expect(await attempt("d2", { directInsert: true }, { _id: "ZZ-P1C-R1" })).toBe("WriteRefused");
    expect(await attempt("d2", { directInsert: true }, {}, { reserve: false })).toBe("WriteRefused"); // nothing reserved
    expect(await attempt("d2", { directInsert: true }, { name: "Real Worker" })).toBe("WriteRefused");
    expect(await attempt("d2", { directInsert: true }, { labourType: "MAAPVALI" })).toBe("WriteRefused");
    expect(inserted).toHaveLength(1);
  });
  it("reserving a labour id is refused outside d2, without the flag, in a read-only run, and a second time", async () => {
    for (const [phase, flags] of [["d2", {}], ["d1", { directInsert: true }], ["precheck", { directInsert: true }], ["p6", { directInsert: true }]]) {
      db.counters.labour = 5;
      await expect(H.makeContext(phase, deps(), { windowStart: "2001-03-01", flags }).reserveLabourId(), phase).rejects.toThrow(H.WriteRefused);
      expect(db.counters.labour).toBe(5); // nothing allocated
    }
    const ctx = H.makeContext("d2", deps(), { windowStart: "2001-03-01", flags: { directInsert: true } });
    expect(await ctx.reserveLabourId()).toBe("L-006");
    await expect(ctx.reserveLabourId()).rejects.toThrow(/second labour id reservation/);
    expect(db.counters.labour).toBe(6);
  });
});

describe("runner basics", () => {
  it("an exception inside a test becomes FAIL, with any connection string hidden", async () => {
    const r = await H.runTest("X", "boom", async () => { throw new Error("cannot reach mongodb+srv://u:SECRETPASS@host/db now"); });
    expect(r.status).toBe("FAIL");
    expect(r.detail).not.toMatch(/SECRETPASS|mongodb\+srv:\/\//);
  });
  it("verdict: FAIL beats INCONCLUSIVE beats PASS, and a skipped test is never a PASS", () => {
    const v = (...s) => H.verdict(s.map((status) => ({ status })));
    expect(v("PASS", "PASS")).toBe(0);
    expect(v("PASS", "SKIPPED")).toBe(3);
    expect(v("PASS", "INCONCLUSIVE")).toBe(3);
    expect(v("INCONCLUSIVE", "FAIL")).toBe(1);
  });
  it("the report lists the records created, never prints a URI, and says which phase it covers", async () => {
    const r = await run("d1");
    const text = H.formatReport(r, { dbName: EXPECTED_DB, host: EXPECTED_CLUSTER_HOST, windowStart: "2001-03-01" }).join("\n");
    expect(text).toMatch(/phase d1/);
    expect(text).toMatch(/removed by this tool/);
    expect(text).toMatch(/labours: L-\d+/);
    expect(text).not.toMatch(/mongodb(\+srv)?:\/\//);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
describe("precheck: read-only", () => {
  it("writes nothing, even with a populated database, and reports the P3 state and missing-rate accounts", async () => {
    await configureSeller();
    const l = await services.labour.createLabour({ labourType: "BIGARI", name: "Real Worker", mobile: "9811111111", village: "V", joiningDate: "2026-01-01", status: "ACTIVE", dailyRate: 650 }, OWNER);
    await services.attendance.saveDay("2026-01-05", { entries: [{ labourId: l.id, status: "PRESENT" }], reason: "x" }, OWNER);
    db.rates.length = 0; // legacy: attendance with no rate row
    const before = snapshot();
    const r = await run("precheck");
    expect(snapshot()).toBe(before);
    expect(r.ledger).toEqual([]);
    expect(statuses(r)).toMatchObject({ "PRE-1": "PASS", "PRE-2": "PASS", "PRE-3": "PASS", "PRE-5": "PASS", "PRE-6": "PASS" });
    expect(byId(r, "PRE-6").detail).toMatch(/accounts with a missing-rate flag: 1/);
    expect(r.facts.p3).toMatchObject({ locked: false });
    expect(r.verdict).toBe(0);
  });
  it("a window that is not free is INCONCLUSIVE, never a pass", async () => {
    db.seasons.set("s", { _id: "s", name: "Old", startDate: "2001-01-01", endDate: "2001-12-31", status: "OPEN", revision: 1 });
    const r = await run("precheck");
    expect(byId(r, "PRE-2").status).toBe("INCONCLUSIVE");
    expect(r.verdict).toBe(3);
  });
  it("reports an already-locked numbering state (finalized bill, no flag)", async () => {
    db.bills.set("b", { _id: "b", status: "FINALIZED", isDeleted: false });
    const r = await run("precheck");
    expect(r.facts.p3).toMatchObject({ flagLocked: false, lockingBills: 1, locked: true });
    expect(byId(r, "PRE-3").detail).toMatch(/cannot be shown/);
  });
  it("a failing transaction probe is INCONCLUSIVE, and every write method is refused throughout", async () => {
    const r = await run("precheck", {}, deps({ probeTransaction: async () => { throw Object.assign(new Error("Transaction numbers are only allowed on a replica set member"), { statusCode: 503 }); } }));
    expect(byId(r, "PRE-5").status).toBe("INCONCLUSIVE");
  });
  it("a salary / balance total that disagrees with its rows is a FAIL", async () => {
    const bad = { ...services, salary: { ...services.salary, getSalarySummary: async () => ({ items: [{ id: "L-1", incomplete: true }], summary: { total: { missingRateAccounts: 2, incomplete: true, earned: 0 }, byType: [{ missingRateAccounts: 1, incomplete: true }] } }) } };
    const r = await run("precheck", {}, deps({ services: bad }));
    expect(byId(r, "PRE-6").status).toBe("FAIL");
  });
});

const D1_IDS = ["D1-LOCK", "D1-0", "D1-1", "D1-2", "D1-3", "D1-4", "D1-5", "D1-6", "D1-7", "D1-8", "D1-T1", "D1-T2", "D1-T3", "D1-IMPACT", "D1-ISO"];
const bad = (r) => JSON.stringify(r.results.filter((x) => x.status !== "PASS").map((x) => `${x.id} ${x.status}: ${x.detail}`));
const allPass = (ids) => Object.fromEntries(ids.map((i) => [i, "PASS"]));
const liveFixtureLabours = () => [...db.labours.values()].filter((l) => l.name.startsWith("ZZ P1C VERIFY"));

describe("D1 (Tier B)", () => {
  it("passes every scenario against the fake and ends with all six fixtures inactive at zero", async () => {
    const r = await run("d1");
    expect(statuses(r), bad(r)).toEqual(allPass(D1_IDS));
    expect(r.verdict).toBe(0);
    const mine = liveFixtureLabours();
    expect(mine).toHaveLength(6);
    expect(mine.every((l) => l.status === "INACTIVE")).toBe(true);
    expect(mine.every((l) => l.statusHistory.at(-1).reason === "ZZ P1C verify tidy")).toBe(true);
    expect(db.seasons.size).toBe(1);
    expect([...db.seasons.values()][0]).toMatchObject({ status: "CLOSED" });
  });
  it("nothing is hard-deleted: every created record is still stored, as deleted / voided / corrected", async () => {
    await run("d1");
    expect([...db.maap.values()].every((m) => m.isDeleted === true)).toBe(true);
    expect([...db.production.values()].every((m) => m.isDeleted === true)).toBe(true);
    expect([...db.payments.values()].every((m) => m.isDeleted === true)).toBe(true);
    expect(db.maap.size).toBe(2);
    expect(db.production.size).toBe(1);
    expect(db.payments.size).toBe(3);
    expect([...db.attendance.values()]).toHaveLength(1);
  });
  it("attendance PRESENT -> ABSENT keeps ONE record, extends its history and reverses the earnings", async () => {
    await run("d1");
    const [att] = [...db.attendance.values()];
    expect(att.status).toBe("ABSENT");
    expect(att.history).toHaveLength(1);
    expect(att.history[0]).toMatchObject({ from: "PRESENT", to: "ABSENT", reason: "ZZ P1C verify tidy" });
  });
  it("each conflict is refused for the right reason, with the worker's own record named", async () => {
    const r = await run("d1");
    expect(byId(r, "D1-2").detail).toMatch(/attendance dated/);
    expect(byId(r, "D1-3").detail).toMatch(/Maapvali entry dated/);
    expect(byId(r, "D1-4").detail).toMatch(/Patlavale production entry dated/);
    expect(byId(r, "D1-5").detail).toMatch(/payment dated/);
  });
  it("every record the phase creates belongs to its own fixtures, and the report lists them (printed as created, too)", async () => {
    const printed = [];
    const r = await run("d1", {}, deps({ onRecord: (x) => printed.push(x) }));
    expect(printed).toEqual(r.ledger);
    const ids = new Set(liveFixtureLabours().map((l) => l._id));
    for (const e of [...db.attendance.values(), ...db.maap.values(), ...db.payments.values(), ...db.production.values()]) expect(ids.has(e.labourId ?? e.recipientId ?? e.teamId)).toBe(true);
    expect(r.ledger.map((x) => x.collection)).toEqual(expect.arrayContaining(["labours", "attendance", "maap", "production", "payments", "seasons"]));
  });
  it("existing business records are untouched: a populated database is identical afterwards apart from the fixtures", async () => {
    await configureSeller();
    const real = await services.labour.createLabour({ labourType: "BIGARI", name: "Real Worker", mobile: "9811111111", village: "V", joiningDate: "2026-01-01", status: "ACTIVE", dailyRate: 650 }, OWNER);
    await services.attendance.saveDay("2026-01-05", { entries: [{ labourId: real.id, status: "PRESENT" }], reason: "x" }, OWNER);
    await services.payment.createPayment({ recipientId: real.id, type: "SALARY_PAYMENT", amount: 100, date: "2026-01-06", method: "CASH", note: "real" }, OWNER);
    const frozen = () => JSON.stringify([db.labours.get(real.id), db.rates.filter((x) => x.labourId === real.id), [...db.attendance.values()].filter((x) => x.labourId === real.id), [...db.payments.values()].filter((x) => x.recipientId === real.id), [...db.invoiceSettings.values()], [...db.bills.values()]]);
    const before = frozen();
    const r = await run("d1");
    expect(r.verdict, bad(r)).toBe(0);
    expect(frozen()).toBe(before);
    expect(byId(r, "D1-IMPACT").detail).toMatch(/labours\.total \+6/);
  });
  it("DETECTS a loose joining-date rule: moving past an attendance record fails D1-2", async () => {
    const real = services.labour.updateLabour;
    const loose = { ...services, labour: { ...services.labour, updateLabour: async (id, c, a) => (c.joiningDate ? (Object.assign(db.labours.get(id), c), {}) : real(id, c, a)) } };
    const r = await run("d1", {}, deps({ services: loose }));
    for (const id of ["D1-2", "D1-3", "D1-4", "D1-5"]) expect(byId(r, id).status).toBe("FAIL");
    expect(r.verdict).toBe(1);
  });
  it("DETECTS a Bayana that wrongly blocks, and a deleted record that wrongly blocks", async () => {
    const real = services.labour.updateLabour;
    const strict = { ...services, labour: { ...services.labour, updateLabour: async (id, c, a) => { if (c.joiningDate) throw Object.assign(new Error("blocked by a record"), { statusCode: 409 }); return real(id, c, a); } } };
    const r = await run("d1", {}, deps({ services: strict }));
    expect(byId(r, "D1-6").status).toBe("FAIL");
    expect(byId(r, "D1-7").status).toBe("FAIL");
  });
  it("DETECTS a joining date that moved without its first rate row (D1-1, D1-8)", async () => {
    const real = services.labour.updateLabour;
    const half = { ...services, labour: { ...services.labour, updateLabour: async (id, c, a) => { if (c.joiningDate && !c.status) { Object.assign(db.labours.get(id), { joiningDate: c.joiningDate }); return {}; } return real(id, c, a); } } };
    const r = await run("d1", {}, deps({ services: half }));
    expect(byId(r, "D1-1").status).toBe("FAIL");
  });
  it("DETECTS a tidy that does not reverse the earnings (ABSENT correction ignored)", async () => {
    const real = services.attendance.saveDay;
    const ignore = { ...services, attendance: { saveDay: async (date, body, a) => (body.reason === "ZZ P1C verify tidy" ? {} : real(date, body, a)) } };
    const r = await run("d1", {}, deps({ services: ignore }));
    expect(byId(r, "D1-T1").status).toBe("FAIL");
  });
  it("DETECTS a tidy that loses the earlier status history", async () => {
    const real = services.labour.updateLabour;
    const wipe = { ...services, labour: { ...services.labour, updateLabour: async (id, c, a) => { const out = await real(id, c, a); if (c.status === "INACTIVE") db.labours.get(id).statusHistory = db.labours.get(id).statusHistory.slice(-1); return out; } } };
    const r = await run("d1", {}, deps({ services: wipe }));
    expect(byId(r, "D1-T3").status).toBe("FAIL");
  });
  it("DETECTS a write outside the fixtures (a stray change to another worker) through the isolation proof", async () => {
    const real = await services.labour.createLabour({ labourType: "BIGARI", name: "Real Worker", mobile: "9811111111", village: "V", joiningDate: "2026-01-01", status: "ACTIVE", dailyRate: 650 }, OWNER);
    const realSave = services.maap.saveDay;
    const stray = { ...services, maap: { ...services.maap, saveDay: async (...a) => { db.labours.get(real.id).village = "TOUCHED"; return realSave(...a); } } };
    const r = await run("d1", {}, deps({ services: stray }));
    expect(byId(r, "D1-ISO").status).toBe("FAIL");
    expect(byId(r, "D1-ISO").detail).toMatch(/outside this run's fixtures/);
  });
  it("DETECTS an unexpected counter change (isolation proof covers every counter except the labour id)", async () => {
    const realPay = services.payment.createPayment;
    const burn = { ...services, payment: { ...services.payment, createPayment: async (...a) => { db.counters["something:else"] = (db.counters["something:else"] ?? 0) + 1; return realPay(...a); } } };
    const r = await run("d1", {}, deps({ services: burn }));
    expect(byId(r, "D1-ISO").status).toBe("FAIL");
  });
  it("DETECTS a permanent effect on the money totals (a payment that is not voided shows up in D1-IMPACT)", async () => {
    const realVoid = services.payment.voidPayment;
    const keep = { ...services, payment: { ...services.payment, voidPayment: async (id, ...a) => (db.payments.get(id).amountPaise === 10000 ? {} : realVoid(id, ...a)) } };
    const r = await run("d1", {}, deps({ services: keep }));
    expect(byId(r, "D1-T2").status).toBe("FAIL"); // the tidy itself notices the payment is not voided
  });
  it("setup failure skips everything else instead of running blind, and still lists what it created", async () => {
    const broken = { ...services, maap: { ...services.maap, saveDay: async () => { throw new Error("nope"); } } };
    const r = await run("d1", {}, deps({ services: broken }));
    expect(byId(r, "D1-0").status).toBe("FAIL");
    expect(r.results.filter((x) => x.id !== "D1-LOCK" && x.id !== "D1-0").every((x) => x.status === "SKIPPED")).toBe(true);
    expect(r.ledger.length).toBeGreaterThan(0);
  });
  it("RETRY SAFETY: a second run refuses to create fixtures while the first run's fixtures exist, and writes nothing", async () => {
    await run("d1");
    const before = snapshot();
    const again = await run("d1", {}, deps({ runNumber: 2, runId: "R2" }));
    expect(byId(again, "D1-LOCK").status).toBe("INCONCLUSIVE");
    expect(byId(again, "D1-LOCK").detail).toMatch(/Nothing was written/);
    expect(again.results.filter((x) => x.id !== "D1-LOCK").every((x) => x.status === "SKIPPED")).toBe(true);
    expect(again.ledger).toEqual([]);
    expect(again.verdict).toBe(3);
    expect(snapshot()).toBe(before);
  });
  it("RETRY SAFETY: an interrupted first run (setup stopped half way) also blocks the retry", async () => {
    const real = services.payment.createPayment;
    let n = 0;
    const flaky = { ...services, payment: { ...services.payment, createPayment: async (...a) => { n += 1; if (n === 2) throw new Error("connection lost"); return real(...a); } } };
    const first = await run("d1", {}, deps({ services: flaky }));
    expect(byId(first, "D1-0").status).toBe("FAIL");
    const created = liveFixtureLabours().length;
    expect(created).toBeGreaterThan(0);
    const again = await run("d1", {}, deps({ runNumber: 3, runId: "R3" }));
    expect(byId(again, "D1-LOCK").status).toBe("INCONCLUSIVE");
    expect(liveFixtureLabours()).toHaveLength(created);
  });
  it("--allow-rerun lets a deliberate second set through (different run id, different mobiles)", async () => {
    await run("d1");
    const again = await H.runPhase("d1", deps({ runNumber: 4, runId: "R4" }), { windowStart: "2002-03-01", flags: { allowRerun: true } }); // the first set's season occupies the first window, so a rerun needs another one
    expect(byId(again, "D1-LOCK").detail).toMatch(/--allow-rerun/);
    expect(again.verdict, bad(again)).toBe(0);
    expect(liveFixtureLabours()).toHaveLength(12);
  });
  it("a worker who already has the fixture's mobile number is never overwritten (numbers are shared now; the run makes its own fixtures)", async () => {
    await services.labour.createLabour({ labourType: "BIGARI", name: "Someone", mobile: "9009000101", village: "V", joiningDate: "2026-01-01", status: "ACTIVE", dailyRate: 650 }, OWNER);
    const before = JSON.stringify([...db.labours.values()].find((l) => l.name === "Someone"));
    await run("d1", {}, deps({ runNumber: 1 }));
    expect(JSON.stringify([...db.labours.values()].find((l) => l.name === "Someone"))).toBe(before);
  });
});

const D2_IDS = ["D2-LOCK", "D2-0", "D2-1", "D2-2", "D2-3", "D2-T", "D2-IMPACT", "D2-ISO"];
describe("D2 / C1 (Tier B)", () => {
  it("with the approved direct insert: flagged, earns nothing, stays flagged and ACTIVE; the rated fixture is tidied", async () => {
    const r = await run("d2", { directInsert: true });
    expect(statuses(r), bad(r)).toEqual(allPass(D2_IDS));
    expect(r.verdict).toBe(0);
    const flagged = [...db.labours.values()].find((l) => l.name.endsWith("D2-NORATE"));
    expect(flagged._id).toMatch(/^L-\d{3,}$/); // a NORMAL labour id
    expect(flagged).toMatchObject({ status: "ACTIVE", labourType: "BIGARI" });
    expect(flagged.statusHistory).toHaveLength(1);
    expect(db.rates.filter((x) => x.labourId === flagged._id)).toEqual([]);
    const att = [...db.attendance.values()].find((x) => x.labourId === flagged._id);
    expect(att).toMatchObject({ status: "PRESENT", history: [] }); // its history untouched
    const rated = [...db.labours.values()].find((l) => l.name.endsWith("D2-OK"));
    expect(rated.status).toBe("INACTIVE");
    expect([...db.attendance.values()].find((x) => x.labourId === rated._id).history).toHaveLength(1);
  });
  it("D2-IMPACT reports the permanent effect: only counts and the missing-rate flag move, no money", async () => {
    const r = await run("d2", { directInsert: true });
    const d = byId(r, "D2-IMPACT").detail;
    expect(d).toMatch(/salary\.missingRateAccounts \+1/);
    expect(d).toMatch(/balances\.missingRateLabours \+1/);
    expect(d).toMatch(/labours\.total \+2/);
    expect(d).toMatch(/unchanged/);
    expect(d).not.toMatch(/salary\.earned|balances\.earned|outstanding \+|overpaid \+/);
  });
  it("without the direct-insert flag: D2-2 is SKIPPED, nothing is inserted directly, exit 3", async () => {
    const inserted = [];
    const r = await run("d2", {}, deps({ insertLegacyLabour: async (d) => inserted.push(d) }));
    expect(byId(r, "D2-2").status).toBe("SKIPPED");
    expect(inserted).toEqual([]);
    expect(r.verdict).toBe(3);
    expect(byId(r, "D2-IMPACT").status).toBe("PASS");
  });
  it("collision: an existing record with the same id or mobile is refused, nothing is overwritten or inserted", async () => {
    const mobile = "9009000112"; // run 1, n 12
    db.labours.set("other", { _id: "other", name: "Real", labourType: "MAAPVALI", mobile, joiningDate: "2020-01-01", status: "ACTIVE", statusHistory: [] });
    const inserted = [];
    const r = await run("d2", { directInsert: true }, deps({ insertLegacyLabour: async (d) => inserted.push(d) }));
    expect(byId(r, "D2-2").status).toBe("INCONCLUSIVE");
    expect(byId(r, "D2-2").detail).toMatch(/collision/);
    expect(inserted).toEqual([]);
    expect(db.labours.get("other").name).toBe("Real");
  });
  it("collision on the id is refused too, without overwriting the existing document", async () => {
    db.labours.set("L-002", { _id: "L-002", name: "Existing", labourType: "BIGARI", mobile: "9000000000", joiningDate: "2020-01-01", status: "ACTIVE", statusHistory: [] }); // D2-OK takes L-001, the fixture would be L-002
    const inserted = [];
    const r = await run("d2", { directInsert: true }, deps({ insertLegacyLabour: async (d) => inserted.push(d) }));
    expect(byId(r, "D2-2").status).toBe("INCONCLUSIVE");
    expect(inserted).toEqual([]);
    expect(db.labours.get("L-002").name).toBe("Existing");
  });
  it("RETRY SAFETY: a second d2 run is blocked while the first run's fixtures exist", async () => {
    await run("d2", { directInsert: true });
    const before = snapshot();
    const again = await run("d2", { directInsert: true }, deps({ runNumber: 2, runId: "R2" }));
    expect(byId(again, "D2-LOCK").status).toBe("INCONCLUSIVE");
    expect(again.ledger).toEqual([]);
    expect(snapshot()).toBe(before);
  });
  it("the guarded insert allows exactly one document per run", async () => {
    const d = deps({ insertLegacyLabour: async () => {} });
    const ctx = H.makeContext("d2", d, { windowStart: "2001-03-01", flags: { directInsert: true } });
    const doc = (id, n) => ({ _id: id, labourType: "BIGARI", name: `ZZ P1C VERIFY R${n} D2-NORATE`, mobile: `90090000${n}9`, village: "ZZ", joiningDate: "2001-03-11", status: "ACTIVE" });
    const id = await ctx.reserveLabourId();
    await ctx.insertLegacyLabour(doc(id, 1));
    await expect(ctx.insertLegacyLabour(doc(id, 2))).rejects.toThrow(/second direct fixture insert/);
  });
  it("the guarded insert refuses any other document shape (extra field, unreserved or non-L id, wrong name, wrong type)", async () => {
    const d = deps({ insertLegacyLabour: async () => {} });
    const make = async () => { const c = H.makeContext("d2", d, { windowStart: "2001-03-01", flags: { directInsert: true } }); return [c, await c.reserveLabourId()]; };
    const good = (id) => ({ _id: id, labourType: "BIGARI", name: "ZZ P1C VERIFY R1 D2-NORATE", mobile: "9009000112", village: "ZZ", joiningDate: "2001-03-11", status: "ACTIVE" });
    const bads = (id) => [{ ...good(id), extra: 1 }, { ...good(id), _id: "L-999" }, { ...good(id), _id: "ZZ-P1C-R1" }, { ...good(id), _id: "L-1" }, { ...good(id), name: "ZZ P1C VERIFY R1 D2-OK" }, { ...good(id), labourType: "MAAPVALI" }, { ...good(id), isDeleted: false }];
    for (let i = 0; i < 7; i += 1) { const [c, id] = await make(); await expect(c.insertLegacyLabour(bads(id)[i]), String(i)).rejects.toThrow(H.WriteRefused); }
    const [c, id] = await make();
    await expect(c.insertLegacyLabour(good(id))).resolves.toBeUndefined();
  });
  it("DETECTS a C1 regression: byType that no longer carries the missing-rate count fails D2-3", async () => {
    const stale = { ...services, salary: { ...services.salary, getSalarySummary: async (...a) => { const s = await services.salary.getSalarySummary(...a); s.summary.byType = s.summary.byType.map((t) => ({ ...t, missingRateAccounts: 0, incomplete: false })); return s; } } };
    const r = await run("d2", { directInsert: true }, deps({ services: stale }));
    expect(byId(r, "D2-3").status).toBe("FAIL");
  });
  it("DETECTS a D2 regression: a missing-rate day that is not flagged fails D2-2", async () => {
    const unflagged = { ...services, balance: { ...services.balance, getBalance: async (id) => ({ ...(await services.balance.getBalance(id)), incomplete: false, missingRateDays: 0 }) } };
    const r = await run("d2", { directInsert: true }, deps({ services: unflagged }));
    expect(byId(r, "D2-1").status).toBe("PASS");
    expect(byId(r, "D2-2").status).toBe("FAIL");
  });
  it("DETECTS a no-rate fixture that earns money (a rate appears) through D2-2", async () => {
    const real = services.attendance.saveDay;
    const rated = { ...services, attendance: { saveDay: async (date, body, a) => { const out = await real(date, body, a); const id = body.entries[0].labourId; if (db.labours.get(id)?.name.endsWith("D2-NORATE")) db.rates.push({ labourId: id, effectiveFrom: "2001-03-10", ratePaise: 65000 }); return out; } } };
    const r = await run("d2", { directInsert: true }, deps({ services: rated }));
    expect(byId(r, "D2-2").status).toBe("FAIL");
  });
  it("DETECTS a tidy that touches the flagged fixture", async () => {
    const real = services.labour.updateLabour;
    const hit = { ...services, labour: { ...services.labour, updateLabour: async (id, c, a) => { const out = await real(id, c, a); const f = [...db.labours.values()].find((l) => l.name.endsWith("D2-NORATE"))?._id; if (c.status === "INACTIVE" && f) db.labours.get(f).village = "CHANGED"; return out; } } };
    const r = await run("d2", { directInsert: true }, deps({ services: hit }));
    expect(byId(r, "D2-T").status).toBe("FAIL");
  });
  it("DETECTS a stray write during D2 (isolation proof)", async () => {
    db.labours.set("real", { _id: "real", name: "Real", labourType: "BIGARI", mobile: "9811111111", joiningDate: "2020-01-01", status: "ACTIVE", statusHistory: [] });
    db.rates.push({ labourId: "real", effectiveFrom: "2020-01-01", ratePaise: 60000 });
    const real = services.attendance.saveDay;
    const stray = { ...services, attendance: { saveDay: async (...a) => { db.labours.get("real").village = "TOUCHED"; return real(...a); } } };
    const r = await run("d2", { directInsert: true }, deps({ services: stray }));
    expect(byId(r, "D2-ISO").status).toBe("FAIL");
  });
});

describe("P6", () => {
  it("passes the deterministic checks on the fake; the race test never FAILs (the fake cannot force a real interleaving)", async () => {
    const r = await run("p6");
    expect(statuses(r)).toMatchObject({ "P6-0": "PASS", "P6-2": "PASS", "P6-3": "PASS", "P6-4": "PASS" });
    expect(["PASS", "INCONCLUSIVE"]).toContain(byId(r, "P6-1").status);
    expect(r.verdict).not.toBe(1);
  });
  it("a race whose rounds all end the same way is INCONCLUSIVE, not a pass", async () => {
    const r = await run("p6");
    const p61 = byId(r, "P6-1");
    if (p61.status === "INCONCLUSIVE") expect(p61.detail).toMatch(/not demonstrated/);
    else expect(p61.detail).toMatch(/Outcomes:/);
  });
  it("DETECTS an entry left outside its season: a save and a season shrink that both succeed fail P6-1", async () => {
    const unguarded = {
      ...services,
      production: { ...services.production, saveDay: async (date, { rows }) => { for (const row of rows) db.production.set(`p-${date}-${row.teamId}`, { _id: `p-${date}-${row.teamId}`, teamId: row.teamId, seasonId: [...db.seasons.keys()][0], date, numberOfMaaps: row.maaps, isDeleted: false }); [...db.seasons.values()][0].revision += 1; return {}; } },
      season: { ...services.season, updateSeason: async (id, patch) => { Object.assign(db.seasons.get(id), patch, { revision: db.seasons.get(id).revision + 1 }); return {}; } },
    };
    // setup uses the real createSeason / createLabour; only the racing calls are unguarded
    const r = await run("p6", {}, deps({ services: unguarded }));
    expect(byId(r, "P6-1").status).toBe("FAIL");
    expect(byId(r, "P6-1").detail).toMatch(/BOTH|outside/);
    expect(r.verdict).toBe(1);
  });
  it("DETECTS a half-applied correction: success reported but the entry unchanged fails P6-2", async () => {
    const liar = { ...services, production: { ...services.production, correctEntry: async () => ({}) } };
    const r = await run("p6", {}, deps({ services: liar }));
    expect(byId(r, "P6-2").status).toBe("FAIL");
  });
  it("DETECTS a refused operation that still changed state (P6-3)", async () => {
    const leaky = { ...services, production: { ...services.production, saveDay: async (date, args, actor) => { if (date >= "2001-04-01" && db.seasons.size) [...db.seasons.values()].forEach((s) => { s.revision += 1; }); return services.production.saveDay(date, args, actor); } } };
    const r = await run("p6", {}, deps({ services: leaky }));
    expect(byId(r, "P6-3").status).toBe("FAIL");
  });
});

describe("D1 then D2 on one database: Labour summary, Balance list and id counter, by stage", () => {
  it("D1 adds 6 (all inactive), D2 adds 2 (1 inactive, 1 active): +8 total, +7 inactive, +1 active, balance list +8, id counter +8", async () => {
    for (let i = 1; i <= 13; i += 1) db.labours.set(`X-${i}`, { _id: `X-${i}`, name: `Real ${i}`, labourType: ["BIGARI", "MAAPVALI", "PATLAVALE"][i % 3], mobile: `98111111${String(i).padStart(2, "0")}`, joiningDate: "2024-01-01", status: i <= 10 ? "ACTIVE" : "INACTIVE", statusHistory: [] });
    const snap = async () => {
      const l = await services.labour.getLabourSummary();
      return { total: l.total, active: l.active, inactive: l.inactive, bigari: l.bigari, maapvali: l.maapvali, patlavale: l.patlavale, balanceList: (await services.balance.listBalances()).totals.labours, idCounter: db.counters.labour ?? 0 };
    };
    const diff = (a, b) => Object.fromEntries(Object.keys(a).map((k) => [k, b[k] - a[k]]));
    db.counters.labour = 41; // a real database's labour id counter does not start at zero: every check below is relative to this
    const s0 = await snap();
    expect(s0).toMatchObject({ total: 13, active: 10, inactive: 3, idCounter: 41 });
    const d1 = await run("d1");
    const s1 = await snap();
    expect(d1.verdict, bad(d1)).toBe(0);
    expect(diff(s0, s1)).toEqual({ total: 6, active: 0, inactive: 6, bigari: 3, maapvali: 2, patlavale: 1, balanceList: 6, idCounter: 6 });
    const d2 = await run("d2", { directInsert: true });
    const s2 = await snap();
    expect(d2.verdict, bad(d2)).toBe(0);
    expect(diff(s1, s2)).toEqual({ total: 2, active: 1, inactive: 1, bigari: 2, maapvali: 0, patlavale: 0, balanceList: 2, idCounter: 2 });
    expect(diff(s0, s2)).toEqual({ total: 8, active: 1, inactive: 7, bigari: 5, maapvali: 2, patlavale: 1, balanceList: 8, idCounter: 8 });
    expect(s2.total).toBe(s2.active + s2.inactive); // the only two statuses
    expect(s2.idCounter).toBe(49); // 41 + 6 (D1) + 2 (D2-OK and the no-rate fixture)
    const types = (rows) => rows.reduce((m, l) => ({ ...m, [l.labourType]: (m[l.labourType] ?? 0) + 1 }), {});
    const fixtures = [...db.labours.values()].filter((l) => l.name.startsWith("ZZ P1C VERIFY"));
    expect(fixtures).toHaveLength(8);
    expect(types(fixtures)).toEqual({ BIGARI: 5, MAAPVALI: 2, PATLAVALE: 1 });
    const label = (l) => l.name.split(" ").slice(4).join(" ");
    expect(Object.fromEntries(fixtures.map((l) => [label(l), l.labourType]))).toEqual({ "D1-A": "BIGARI", "D1-M": "MAAPVALI", "D1-P": "PATLAVALE", "D1-PAY": "BIGARI", "D1-BAY": "BIGARI", "D1-DEL": "MAAPVALI", "D2-OK": "BIGARI", "D2-NORATE": "BIGARI" });
  });
  it("the id counter moves by 8: both D2 fixtures take a normal number, in order, with no gap and no collision for the next real worker", async () => {
    db.counters.labour = 1000; // not zero: the test checks the CHANGE, as the harness does
    await run("d1");
    await run("d2", { directInsert: true });
    expect(db.counters.labour - 1000).toBe(8);
    expect([...db.labours.keys()].filter((k) => !/^L-\d{3,}$/.test(k))).toEqual([]); // every id is a normal labour id
    expect(db.labours.size).toBe(8);
    const ids = [...db.labours.keys()].sort();
    expect(ids).toEqual(["L-1001", "L-1002", "L-1003", "L-1004", "L-1005", "L-1006", "L-1007", "L-1008"]);
    const byName = (n) => [...db.labours.values()].find((l) => l.name.endsWith(n))._id;
    expect(byName("D2-OK")).toBe("L-1007"); // created first
    expect(byName("D2-NORATE")).toBe("L-1008"); // reserved right after
    const next = await services.labour.createLabour({ labourType: "BIGARI", name: "Real next worker", mobile: "9812345678", village: "V", joiningDate: "2024-01-01", status: "ACTIVE", dailyRate: 700 }, { name: "t", id: null });
    expect(next.id).toBe("L-1009"); // no collision with the fixture
  });
});

describe("D2 no-rate fixture id: model validity, attendance, counter and retry safety", () => {
  it("the flagged id and document pass the REAL Labour and Attendance schemas (no database)", async () => {
    const { default: RealLabour } = await vi.importActual("../models/Labour.js");
    const { default: RealAttendance } = await vi.importActual("../models/Attendance.js");
    db.counters.labour = 19;
    await run("d2", { directInsert: true });
    const doc = db.labours.get("L-021");
    expect(doc.name).toMatch(/D2-NORATE$/);
    const l = new RealLabour({ ...doc });
    expect(l.validateSync()).toBeUndefined();
    const att = [...db.attendance.values()].find((a) => a.labourId === "L-021");
    expect(new RealAttendance({ labourId: att.labourId, date: att.date, status: att.status }).validateSync()).toBeUndefined();
    // the OLD id shape is what the real model rejects
    expect(new RealAttendance({ labourId: "ZZ-P1C-R1234", date: "2001-03-21", status: "PRESENT" }).validateSync()).toBeDefined();
  });
  it("order and counter: D2-OK is L-020, the no-rate fixture L-021, the counter ends at 21 and the next real worker gets L-022", async () => {
    db.counters.labour = 19;
    const r = await run("d2", { directInsert: true });
    expect(r.verdict, bad(r)).toBe(0);
    expect(db.labours.get("L-020").name).toMatch(/D2-OK$/);
    expect(db.labours.get("L-021").name).toMatch(/D2-NORATE$/);
    expect(db.counters.labour).toBe(21);
    const next = await services.labour.createLabour({ labourType: "BIGARI", name: "Real next", mobile: "9812345679", village: "V", joiningDate: "2024-01-01", status: "ACTIVE", dailyRate: 700 }, { name: "t", id: null });
    expect(next.id).toBe("L-022");
    expect(r.ledger.map((x) => `${x.collection}:${x.id}`)).toEqual(["labours:L-020", "attendance:L-020@2001-05-10", "counters:labour", "labours:L-021", "attendance:L-021@2001-05-10"]);
  });
  it("the no-rate scenario is preserved with the valid id: attendance saved, no rate row, flagged in all views, earns nothing", async () => {
    db.counters.labour = 19;
    const r = await run("d2", { directInsert: true });
    expect(byId(r, "D2-2").status).toBe("PASS");
    expect(db.rates.filter((x) => x.labourId === "L-021")).toEqual([]);
    expect([...db.attendance.values()].find((a) => a.labourId === "L-021")).toMatchObject({ status: "PRESENT", date: "2001-05-10", revision: 1, history: [] });
    const bal = await services.balance.getBalance("L-021");
    expect(bal).toMatchObject({ incomplete: true, missingRateDays: 1, earned: 0 });
    const row = (await services.salary.getSalarySummary()).items.find((x) => x.id === "L-021");
    expect(row).toMatchObject({ incomplete: true });
    expect(row.missingRate).toMatchObject({ days: 1, firstDate: "2001-05-10" });
  });
  it("a collision on the reserved id leaves a counter gap but no overwrite and no duplicate (same as the app)", async () => {
    db.counters.labour = 19;
    db.labours.set("L-021", { _id: "L-021", name: "Existing", labourType: "BIGARI", mobile: "9000000000", joiningDate: "2020-01-01", status: "ACTIVE", statusHistory: [] });
    const inserted = [];
    const r = await run("d2", { directInsert: true }, deps({ insertLegacyLabour: async (d) => inserted.push(d) }));
    expect(byId(r, "D2-2").status).toBe("INCONCLUSIVE");
    expect(inserted).toEqual([]);
    expect(db.labours.get("L-021").name).toBe("Existing");
    expect(db.counters.labour).toBe(21); // reserved, never reused
  });
  it("RETRY: an interruption AFTER the fixture was inserted (attendance fails) leaves it, and the next run is blocked by D2-LOCK", async () => {
    db.counters.labour = 19;
    const real = services.attendance.saveDay;
    const failing = { ...services, attendance: { ...services.attendance, saveDay: async (date, body, a) => { if (body.entries[0].labourId === "L-021") throw new Error("connection lost"); return real(date, body, a); } } };
    const r = await run("d2", { directInsert: true }, deps({ services: failing }));
    expect(byId(r, "D2-2").status).toBe("FAIL");
    expect(db.labours.has("L-021")).toBe(true);
    const before = snapshot();
    const again = await run("d2", { directInsert: true }, deps({ runNumber: 2, runId: "R2" }));
    expect(byId(again, "D2-LOCK").status).toBe("INCONCLUSIVE");
    expect(byId(again, "D2-LOCK").detail).toMatch(/L-020/);
    expect(byId(again, "D2-LOCK").detail).toMatch(/L-021/);
    expect(again.ledger).toEqual([]);
    expect(snapshot()).toBe(before);
  });
  it("RETRY: a process that died right after D2-OK was created (only L-020 exists, nothing reserved) is also blocked", async () => {
    db.counters.labour = 19;
    await services.labour.createLabour({ labourType: "BIGARI", name: `${H.FIXTURE.prefix} R1 D2-OK`, mobile: "9009000111", village: "ZZ", joiningDate: "2001-03-11", status: "ACTIVE", dailyRate: 650 }, { name: "t", id: null });
    expect(db.counters.labour).toBe(20);
    const before = snapshot();
    const again = await run("d2", { directInsert: true }, deps({ runNumber: 2, runId: "R2" }));
    expect(byId(again, "D2-LOCK").status).toBe("INCONCLUSIVE");
    expect(again.ledger).toEqual([]);
    expect(snapshot()).toBe(before); // nothing reserved, nothing written
  });
  it("a completed D2 blocks a second D2 and nothing is reserved or written", async () => {
    db.counters.labour = 19;
    await run("d2", { directInsert: true });
    const before = snapshot();
    const again = await run("d2", { directInsert: true }, deps({ runNumber: 3, runId: "R3" }));
    expect(byId(again, "D2-LOCK").status).toBe("INCONCLUSIVE");
    expect(db.counters.labour).toBe(21);
    expect(snapshot()).toBe(before);
  });
  it("the real script wires nothing new: it still passes the single guarded insert and no counter write of its own", () => {
    const src = readFileSync(new URL("../scripts/verifyPhase1C.js", import.meta.url), "utf8");
    expect(src.match(/insertOne/g)).toHaveLength(1);
    expect(src).not.toMatch(/counters\.collection|findOneAndUpdate|\$inc/);
  });
});

describe("retry safety for P6 and P3", () => {
  it("P6 refuses to start while an earlier P6 run's fixtures exist, and writes nothing", async () => {
    await run("p6");
    const before = snapshot();
    const again = await run("p6", {}, deps({ runNumber: 2, runId: "R2" }));
    expect(byId(again, "P6-LOCK").status).toBe("INCONCLUSIVE");
    expect(again.ledger).toEqual([]);
    expect(snapshot()).toBe(before);
  });
  it("P3 refuses to start while an earlier P3 run's fixture bills exist, and writes nothing", async () => {
    await configureSeller();
    await run("p3");
    const before = snapshot();
    const again = await run("p3", {}, deps({ runNumber: 2, runId: "R2" }));
    expect(byId(again, "P3-LOCK").status).toBe("INCONCLUSIVE");
    expect(again.results.filter((x) => x.id !== "P3-LOCK").every((x) => x.status === "SKIPPED")).toBe(true);
    expect(snapshot()).toBe(before);
  });
});

describe("P3", () => {
  const settingsRow = () => db.invoiceSettings.get("default");
  it("fresh test database (seller configured): draft does not lock; first finalize locks; numbering frozen; failed finalize clean", async () => {
    await configureSeller();
    const r = await run("p3");
    expect(statuses(r)).toEqual({ "P3-LOCK": "PASS", "P3-1": "PASS", "P3-5": "SKIPPED", "P3-2": "PASS", "P3-3": "PASS", "P3-4": "SKIPPED", "P3-6": "PASS", "P3-7": "PASS" });
    expect(settingsRow().numberingLocked).toBe(true);
    expect(r.verdict).toBe(3); // skipped tests are never reported as a pass
    expect(r.ledger.some((l) => l.note.includes("FINALIZED (permanent)"))).toBe(true);
    expect([...db.bills.values()].filter((b) => b.status === "DRAFT" && !b.isDeleted)).toEqual([]);
  });
  // The fake has no isolation (a rolled-back transaction restores a snapshot that includes a rival's writes), so a truly concurrent race is
  // meaningless here. The two possible orders are driven explicitly instead; the harness's classification and invariants are what is tested.
  const ordered = (first) => {
    let release;
    const gate = new Promise((r) => { release = r; });
    const wrap = (fn, name) => async (...a) => {
      if (name === first) { try { return await fn(...a); } finally { release(); } }
      await gate;
      return fn(...a);
    };
    return { ...services, bill: { ...services.bill, finalizeBill: wrap(services.bill.finalizeBill, "finalize") }, invoiceSettings: { ...services.invoiceSettings, updateSettings: wrap(services.invoiceSettings.updateSettings, "change") } };
  };
  it("race, finalize first: the numbering change is refused (409) and the bill keeps the old format", async () => {
    await configureSeller();
    const r = await run("p3", { numberingRace: true }, deps({ services: ordered("finalize") }));
    expect(byId(r, "P3-5")).toMatchObject({ status: "PASS", detail: expect.stringMatching(/finalize succeeded, numbering change 409/) });
    expect(byId(r, "P3-2").status).toBe("PASS");
    expect(byId(r, "P3-3").status).toBe("PASS");
    expect(r.results.some((x) => x.status === "FAIL")).toBe(false);
  });
  it("race, numbering change first: the change is stored and the bill uses the NEW format; then locked", async () => {
    await configureSeller();
    const r = await run("p3", { numberingRace: true }, deps({ services: ordered("change") }));
    expect(byId(r, "P3-5")).toMatchObject({ status: "PASS", detail: expect.stringMatching(/finalize succeeded, numbering change succeeded/) });
    expect(db.invoiceSettings.get("default").numberingLocked).toBe(true);
    expect(r.results.some((x) => x.status === "FAIL")).toBe(false);
  });
  it("DETECTS mixed formats: change committed first but the bill still numbered with the old padding (P3-5 FAIL)", async () => {
    await configureSeller();
    const svc = ordered("change");
    const real = svc.bill.finalizeBill;
    svc.bill = { ...svc.bill, finalizeBill: async (...a) => { const out = await real(...a); const bill = db.bills.get(a[0]); bill.billNumber = bill.billNumber.replace(/\d+$/, (d) => d.slice(0, 1)); return out; } };
    const r = await run("p3", { numberingRace: true }, deps({ services: svc }));
    expect(byId(r, "P3-5").status).toBe("FAIL");
    expect(byId(r, "P3-5").detail).toMatch(/mixed/);
  });
  it("DETECTS a finalize that fails yet used a number during the race (P3-5 FAIL)", async () => {
    await configureSeller();
    const svc = ordered("change");
    svc.bill = { ...svc.bill, finalizeBill: async () => { db.counters["bill:x"] = 1; throw Object.assign(new Error("stale"), { statusCode: 409 }); } };
    const r = await run("p3", { numberingRace: true }, deps({ services: svc }));
    expect(byId(r, "P3-5").status).toBe("FAIL");
    expect(byId(r, "P3-5").detail).toMatch(/invoice number/);
  });
  it("race without --accept-numbering-race is SKIPPED and numbering is never changed", async () => {
    await configureSeller();
    const r = await run("p3");
    expect(byId(r, "P3-5").status).toBe("SKIPPED");
  });
  it("already locked by a legacy finalized bill: first-lock tests are INCONCLUSIVE, the legacy and post-lock tests run", async () => {
    await configureSeller();
    db.bills.set("legacy", { _id: "legacy", status: "FINALIZED", billNumber: "AC/2025-26/0001", isDeleted: false, revision: 2 });
    const r = await run("p3");
    expect(statuses(r)).toMatchObject({ "P3-1": "INCONCLUSIVE", "P3-2": "INCONCLUSIVE", "P3-3": "PASS", "P3-4": "PASS", "P3-6": "PASS" });
    expect([...db.bills.values()].filter((b) => b.status === "FINALIZED")).toHaveLength(1); // the harness added no finalized bill
  });
  it("seller details incomplete: the failed finalize leaves no lock and no number; the harness never edits seller settings", async () => {
    const before = snapshot();
    const r = await run("p3");
    expect(byId(r, "P3-2").status).toBe("INCONCLUSIVE");
    expect(byId(r, "P3-2").detail).toMatch(/never edits seller settings/);
    expect(settingsRow()?.numberingLocked).not.toBe(true);
    expect(db.counters).toEqual({});
    expect(db.invoiceSettings.size).toBe(0);
    expect(snapshot()).not.toBe(before); // drafts were created and discarded
  });
  it("the harness never changes numbering on an unlocked database unless the race flag is given", async () => {
    await configureSeller();
    const numbering = clone(settingsRow().numbering ?? null);
    await run("p3");
    expect(clone(settingsRow().numbering ?? null)).toEqual(numbering);
  });
  it("DETECTS a missing lock: finalize that does not set the flag fails P3-2", async () => {
    await configureSeller();
    const noLock = { ...services, bill: { ...services.bill, finalizeBill: async (...a) => { const out = await services.bill.finalizeBill(...a); delete settingsRow().numberingLocked; delete settingsRow().numberingLockedAt; return out; } } };
    const r = await run("p3", {}, deps({ services: noLock }));
    expect(byId(r, "P3-2").status).toBe("FAIL");
  });
  it("DETECTS numbering that can still change after the lock (P3-3 FAIL)", async () => {
    await configureSeller();
    const lax = { ...services, invoiceSettings: { ...services.invoiceSettings, updateSettings: async (body) => { Object.assign(settingsRow().numbering ?? (settingsRow().numbering = {}), body.numbering); return {}; } } };
    const r = await run("p3", {}, deps({ services: lax }));
    expect(byId(r, "P3-3").status).toBe("FAIL");
    expect(byId(r, "P3-3").detail).toMatch(/expected 409/);
  });
  it("DETECTS a failed finalize that leaves a partial lock (P3-6 FAIL)", async () => {
    await configureSeller();
    const leak = { ...services, bill: { ...services.bill, finalizeBill: async (id, ...a) => { const b = db.bills.get(id); if (!b.items?.length) { settingsRow().numberingLockedAt = "leaked"; throw Object.assign(new Error("not ready"), { statusCode: 400 }); } return services.bill.finalizeBill(id, ...a); } } };
    const r = await run("p3", {}, deps({ services: leak }));
    expect(byId(r, "P3-6").status).toBe("FAIL");
  });
  it("DETECTS a failed finalize that burns an invoice number (P3-6 FAIL)", async () => {
    await configureSeller();
    const burn = { ...services, bill: { ...services.bill, finalizeBill: async (id, ...a) => { const b = db.bills.get(id); if (!b.items?.length) { db.counters["bill:x"] = (db.counters["bill:x"] ?? 0) + 1; throw Object.assign(new Error("not ready"), { statusCode: 400 }); } return services.bill.finalizeBill(id, ...a); } } };
    const r = await run("p3", {}, deps({ services: burn }));
    expect(byId(r, "P3-6").status).toBe("FAIL");
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// Atlas D1 failure: the native driver does not cast "<24 hex>" to ObjectId, so D1-7 / D1-T2 read nothing and D1-6 compared undefined === undefined.
// These tests use the strict BSON-view reader above (real mongoose ObjectId, no string matching). Fake-database / real-BSON-class results only.
describe("ObjectId-backed reads (Atlas D1 regression)", () => {
  const HEX = "64b7f0c2a1d3e4f5a6b7c8d9";
  const hexOf = (id) => String(id);
  const blind = (collections) => async (name, filter = {}) => (collections.includes(name) && "_id" in filter ? [] : nativeRead(name, filter)); // setup reads work, but every lookup BY _id in these collections finds nothing (the Atlas symptom)

  it("uses the real BSON ObjectId class: serialize/deserialize round-trips and equality holds", () => {
    const { BSON } = mongoose.mongo;
    const back = BSON.deserialize(BSON.serialize({ _id: toObjectId(HEX) }))._id;
    expect(back).toBeInstanceOf(mongoose.mongo.ObjectId);
    expect(back.toHexString()).toBe(HEX);
    expect(toObjectId(HEX)).toBeInstanceOf(OID);
  });
  it("normalizeFilter converts a 24-hex _id (direct, $in, $ne, $or) for ObjectId collections only", () => {
    const n = (c, f) => H.normalizeFilter(c, f, toObjectId);
    expect(n("maap", { _id: HEX })._id).toBeInstanceOf(OID);
    expect(n("maap", { _id: { $in: [HEX, "L-014"] } })._id.$in[0]).toBeInstanceOf(OID);
    expect(n("maap", { _id: { $in: [HEX, "L-014"] } })._id.$in[1]).toBe("L-014");
    expect(n("payments", { _id: { $ne: HEX } })._id.$ne).toBeInstanceOf(OID);
    expect(n("seasons", { $or: [{ _id: HEX }, { status: "OPEN" }] }).$or[0]._id).toBeInstanceOf(OID);
    expect(n("bills", { _id: HEX })._id).toBeInstanceOf(OID);
    expect(n("production", { _id: toObjectId(HEX) })._id.toHexString()).toBe(HEX);
  });
  it("ordinary string ids and unrelated fields are never converted", () => {
    const n = (c, f) => H.normalizeFilter(c, f, toObjectId);
    expect(n("labours", { _id: "L-014" })).toEqual({ _id: "L-014" });
    expect(n("labours", { _id: HEX })._id).toBe(HEX); // string-id collection: untouched even if it looks like hex
    expect(n("counters", { _id: "labour" })).toEqual({ _id: "labour" });
    expect(n("settings", { _id: "default" })).toEqual({ _id: "default" });
    expect(n("maap", { _id: "not-hex" })._id).toBe("not-hex");
    const f = n("maap", { labourId: HEX, teamId: HEX, seasonId: HEX, recipientId: HEX, _id: HEX });
    expect(f.labourId).toBe(HEX);
    expect(f.teamId).toBe(HEX);
    expect(f.seasonId).toBe(HEX);
    expect(f.recipientId).toBe(HEX);
  });
  it("gateRead needs toObjectId", () => {
    expect(() => H.gateRead(nativeRead)).toThrow(/toObjectId/);
  });
  it("reproduces the Atlas failure: a raw hex-string read finds nothing, the gated read finds the ObjectId document", async () => {
    await run("d1");
    const row = db.maap.values().next().value;
    expect(await nativeRead("maap", { _id: hexOf(row._id) })).toEqual([]); // what the old harness did
    const gated = H.gateRead(nativeRead, toObjectId);
    const found = await gated("maap", { _id: hexOf(row._id) });
    expect(found).toHaveLength(1);
    expect(found[0]._id).toBeInstanceOf(OID);
    expect(await gated("labours", { _id: "L-001" })).toHaveLength(1); // string ids still work
  });
  it("D1 passes on the strict reader; D1-6 and D1-7 report that they verified the real stored records", async () => {
    const r = await run("d1");
    expect(r.results.filter((x) => x.status !== "PASS")).toEqual([]);
    expect(byId(r, "D1-6").detail ?? byId(r, "D1-6").message ?? JSON.stringify(byId(r, "D1-6"))).toMatch(/byte-identical/);
    expect(JSON.stringify(byId(r, "D1-7"))).toMatch(/still marked deleted/);
    expect(JSON.stringify(byId(r, "D1-T2"))).toMatch(/read back as CLOSED/);
  });
  it("after D1 the tidied records are really soft-deleted/voided and the season is CLOSED in the store", async () => {
    await run("d1");
    expect([...db.maap.values()].every((m) => m.isDeleted === true)).toBe(true);
    expect([...db.production.values()].every((m) => m.isDeleted === true)).toBe(true);
    expect([...db.seasons.values()].every((x) => x.status === "CLOSED")).toBe(true);
  });
  it("a reader that cannot find the Bayana / voided payment makes D1-6 and D1-7 FAIL (no false pass)", async () => {
    const r = await run("d1", {}, deps({ read: blind(["payments"]) }));
    expect(byId(r, "D1-6").status).toBe("FAIL");
    expect(byId(r, "D1-7").status).toBe("FAIL");
  });
  it("a reader that cannot find the soft-deleted Maapvali entry makes D1-7 FAIL", async () => {
    const r = await run("d1", {}, deps({ read: blind(["maap"]) }));
    expect(byId(r, "D1-7").status).toBe("FAIL");
  });
  it("a reader that cannot find the season makes D1-T2 FAIL with a clear message, not a TypeError", async () => {
    const r = await run("d1", {}, deps({ read: blind(["seasons"]) }));
    const t2 = byId(r, "D1-T2");
    expect(t2.status).toBe("FAIL");
    expect(JSON.stringify(t2)).not.toMatch(/Cannot read properties of undefined/);
    expect(JSON.stringify(t2)).toMatch(/expected exactly 1 stored document/);
  });
  it("D1-T2 fails when a cleanup operation does not actually mark the record deleted", async () => {
    const lying = { ...services, maap: { ...services.maap, deleteEntry: async () => ({}) } };
    const r = await run("d1", {}, deps({ services: lying }));
    expect(byId(r, "D1-T2").status).toBe("FAIL");
    expect(JSON.stringify(byId(r, "D1-T2"))).toMatch(/not marked deleted/);
  });
  it("D1-6 fails when the Bayana changes during the move", async () => {
    const touch = { ...services, labour: { ...services.labour, updateLabour: async (id, patch, a) => { const out = await services.labour.updateLabour(id, patch, a); if (patch.joiningDate) for (const p of db.payments.values()) if (p.type === "BOOKING_ADVANCE") p.amountPaise += 1; return out; } } };
    const r = await run("d1", {}, deps({ services: touch }));
    expect(byId(r, "D1-6").status).toBe("FAIL");
  });
  it("P6 reads of ObjectId-backed production entries and seasons work on the strict reader", async () => {
    const r = await run("p6");
    expect(statuses(r)).toMatchObject({ "P6-2": "PASS", "P6-3": "PASS", "P6-4": "PASS" });
  });
  it("P6 fails (not passes) when the season documents cannot be read", async () => {
    const r = await run("p6", {}, deps({ read: blind(["seasons"]) }));
    expect(r.results.some((x) => x.status === "FAIL")).toBe(true);
    expect(r.verdict).toBe(1);
  });
  it("P3 reads of ObjectId-backed bills work on the strict reader", async () => {
    await configureSeller();
    const r = await run("p3");
    expect(statuses(r)).toMatchObject({ "P3-6": "PASS", "P3-7": "PASS" });
  });
  it("P3 fails (not passes) when bills cannot be read", async () => {
    await configureSeller();
    const r = await run("p3", {}, deps({ read: blind(["bills"]) }));
    expect(r.results.some((x) => x.status === "FAIL")).toBe(true);
    expect(r.verdict).toBe(1);
  });
  it("the live script passes the BSON ObjectId constructor to the harness and the harness still imports only patlavaleHarness", () => {
    expect(readFileSync(new URL("../scripts/verifyPhase1C.js", import.meta.url), "utf8")).toMatch(/toObjectId:\s*\(hex\)\s*=>\s*new mongoose\.Types\.ObjectId\(hex\)/);
    const imports = [...readFileSync(new URL("../scripts/lib/phase1cHarness.js", import.meta.url), "utf8").matchAll(/^import .* from "(.+)";/gm)].map((m) => m[1]);
    expect(imports).toEqual(["./patlavaleHarness.js"]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// P6 revision: read-only preflight, tidy, impact and isolation. FAKE DATABASE only: the fake cannot interleave a real race, so P6-1 is INCONCLUSIVE here.
describe("P6 preflight (read-only, refuses before any write)", () => {
  const W = { windowFrom: "2001-06-01", windowTo: "2001-07-30", seasonNames: ["ZZ P1C VERIFY R1 P6-S1"], mobiles: ["9009002199"] };
  const season = (startDate, endDate, status = "CLOSED", name = "x") => ({ name, startDate, endDate, status });
  const bad = (seasons, extra = {}) => H.p6PreflightProblems({ seasons, labours: [], ...W, ...extra });
  it("detects every overlap shape: identical, starts inside, ends inside, contains, contained, touching on one day", () => {
    for (const [a, b] of [["2001-06-01", "2001-07-30"], ["2001-07-15", "2001-09-01"], ["2001-05-01", "2001-06-10"], ["2001-01-01", "2001-12-31"], ["2001-06-10", "2001-06-20"], ["2001-05-01", "2001-06-01"], ["2001-07-30", "2001-08-30"]]) expect(bad([season(a, b)]).length, `${a}..${b}`).toBe(1);
  });
  it("accepts seasons that end the day before or start the day after the window", () => {
    expect(bad([season("2001-03-01", "2001-05-31"), season("2001-07-31", "2001-09-30")])).toEqual([]);
  });
  it("an open-ended season overlaps from its start onwards, CLOSED or OPEN alike", () => {
    expect(bad([season("2001-01-01", null, "OPEN")]).length).toBe(1);
    expect(bad([season("2001-06-15", null, "CLOSED")]).length).toBe(1);
    expect(bad([season("2001-08-01", null, "OPEN")])).toEqual([]);
  });
  it("matches a brute-force day-by-day check for many windows and seasons", () => {
    const base = Date.UTC(2001, 0, 1);
    const d = (n) => new Date(base + n * 864e5).toISOString().slice(0, 10);
    let seed = 7;
    const rnd = (m) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % m; };
    for (let i = 0; i < 400; i += 1) {
      const wf = rnd(300), wt = wf + 59, sf = rnd(360), st = rnd(4) === 0 ? null : sf + rnd(120);
      let brute = false;
      for (let n = wf; n <= wt; n += 1) if (n >= sf && (st === null || n <= st)) brute = true;
      const found = H.p6PreflightProblems({ seasons: [season(d(sf), st === null ? null : d(st))], labours: [], windowFrom: d(wf), windowTo: d(wt), seasonNames: [], mobiles: [] }).length > 0;
      expect(found, `${d(wf)}..${d(wt)} vs ${d(sf)}..${st === null ? "open" : d(st)}`).toBe(brute);
    }
  });
  it("also refuses a season-name clash and a worker that already uses a mobile number the run would create", () => {
    expect(bad([season("2001-01-01", "2001-02-01", "CLOSED", "ZZ P1C VERIFY R1 P6-S1")])[0]).toMatch(/already exists/);
    expect(H.p6PreflightProblems({ seasons: [], labours: [{ _id: "L-007", mobile: "9009002199" }], ...W })[0]).toMatch(/L-007 already uses/);
  });
  it("refuses a window that overlaps an existing season: P6-PRE FAILS, everything else is SKIPPED, nothing is written, no counter moves", async () => {
    db.counters.labour = 13;
    await run("d1", {}, deps({ runNumber: 4321, runId: "R4321" })); // D1's season is 2001-03-01..2001-04-29
    const before = snapshot();
    const r = await run("p6", {}, deps({ runNumber: 555, runId: "R555" })); // default window 2001-03-01
    expect(statuses(r)).toEqual({ "P6-LOCK": "PASS", "P6-PRE": "FAIL", "P6-0": "SKIPPED", "P6-1": "SKIPPED", "P6-2": "SKIPPED", "P6-3": "SKIPPED", "P6-4": "SKIPPED", "P6-T": "SKIPPED", "P6-IMPACT": "SKIPPED", "P6-ISO": "SKIPPED" });
    expect(byId(r, "P6-PRE").detail).toMatch(/REFUSED before any write.*overlaps the existing season .*D1-SEASON/);
    expect(r.ledger).toEqual([]);
    expect(r.verdict).toBe(1);
    expect(snapshot()).toBe(before);
  });
  it("the preflight cannot be bypassed by --allow-rerun, and runs whatever window is chosen", async () => {
    await run("d1");
    const before = snapshot();
    for (const start of ["2001-03-01", "2001-03-20", "2001-02-01"]) {
      const r = await H.runPhase("p6", deps({ runNumber: 556, runId: "R556" }), { windowStart: start, flags: { allowRerun: true } });
      expect(byId(r, "P6-PRE").status, start).toBe("FAIL");
    }
    expect(snapshot()).toBe(before);
  });
  it("a window next to D1's season passes and the whole P6 phase runs", async () => {
    await run("d1");
    const r = await H.runPhase("p6", deps({ runNumber: 557, runId: "R557" }), { windowStart: "2001-06-01", flags: {} });
    expect(byId(r, "P6-PRE").status).toBe("PASS");
    expect(r.results.every((x) => x.status !== "SKIPPED")).toBe(true);
  });
  it("an existing season that overlaps only part of the window (e.g. a real open-ended one) is also refused before any write", async () => {
    db.seasons.set("real", { _id: "real", name: "Real 2001", startDate: "2001-07-10", endDate: null, status: "OPEN", revision: 1 });
    const before = snapshot();
    const r = await H.runPhase("p6", deps(), { windowStart: "2001-06-01", flags: {} });
    expect(byId(r, "P6-PRE").status).toBe("FAIL");
    expect(snapshot()).toBe(before);
  });
  it("the preflight only reads: no write method of any service is called while it refuses", async () => {
    await run("d1");
    const calls = [];
    const spy = Object.fromEntries(Object.entries(services).map(([k, mod]) => [k, Object.fromEntries(Object.entries(mod).map(([n, f]) => [n, typeof f === "function" ? async (...a) => { calls.push(`${k}.${n}`); return f(...a); } : f]))]));
    await run("p6", {}, deps({ services: spy, runNumber: 558, runId: "R558" }));
    expect(calls).toEqual([]);
  });
});

describe("P6 tidy, impact and isolation", () => {
  const P6 = (d) => H.runPhase("p6", d ?? deps({ runNumber: 555, runId: "R555" }), { windowStart: "2001-06-01", flags: {} });
  const teamIds = () => [...db.labours.values()].filter((l) => /P6-T/.test(l.name)).map((l) => l._id);
  const populate = async () => {
    db.counters.labour = 13;
    await run("d1", {}, deps({ runNumber: 4321, runId: "R4321" }));
    await run("d2", { directInsert: true }, deps({ runNumber: 8765, runId: "R8765" }));
    const real = await services.labour.createLabour({ labourType: "BIGARI", name: "Real Worker", mobile: "9811111111", village: "V", joiningDate: "2026-01-01", status: "ACTIVE", dailyRate: 650 }, OWNER);
    await services.attendance.saveDay("2026-01-05", { entries: [{ labourId: real.id, status: "PRESENT" }], reason: "x" }, OWNER);
    await services.payment.createPayment({ recipientId: real.id, type: "SALARY_PAYMENT", amount: 1000, date: "2026-01-06", method: "CASH", note: "real" }, OWNER);
    return real;
  };
  it("full run on a populated database: every test passes (P6-1 may be INCONCLUSIVE on the fake) and the final state is tidy", async () => {
    await populate();
    const r = await P6();
    expect(statuses(r)).toMatchObject({ "P6-LOCK": "PASS", "P6-PRE": "PASS", "P6-0": "PASS", "P6-2": "PASS", "P6-3": "PASS", "P6-4": "PASS", "P6-T": "PASS", "P6-IMPACT": "PASS", "P6-ISO": "PASS" });
    expect(["PASS", "INCONCLUSIVE"]).toContain(byId(r, "P6-1").status);
    expect(r.verdict).not.toBe(1);
    const ids = teamIds();
    expect(ids).toHaveLength(2);
    expect(ids.map((i) => db.labours.get(i).status)).toEqual(["INACTIVE", "INACTIVE"]);
    const mine = [...db.production.values()].filter((e) => ids.includes(e.teamId));
    expect(mine.length).toBeGreaterThan(2);
    expect(mine.every((e) => e.isDeleted === true && e.deletedReason === H.FIXTURE.reasons.tidy && Boolean(e.deletedBy) && Boolean(e.deletedAt))).toBe(true);
    const seasons = [...db.seasons.values()].filter((x) => /P6-S/.test(x.name));
    expect(seasons.map((x) => x.status)).toEqual(["CLOSED", "CLOSED"]);
    expect(seasons.map((x) => `${x.startDate}..${x.endDate}`)).toEqual(["2001-06-01..2001-06-30", "2001-07-01..2001-07-30"]);
  });
  it("tidy order: every soft delete happens before any worker is deactivated, and the seasons are closed last", async () => {
    await populate();
    const log = [];
    const spy = { ...services, production: { ...services.production, deleteEntry: async (...a) => { log.push("delete"); return services.production.deleteEntry(...a); } },
      labour: { ...services.labour, updateLabour: async (id, patch, ...a) => { if (patch.status === "INACTIVE") log.push("deactivate"); return services.labour.updateLabour(id, patch, ...a); } },
      season: { ...services.season, updateSeason: async (id, patch, ...a) => { if (patch.status === "CLOSED") log.push("close"); return services.season.updateSeason(id, patch, ...a); } } };
    await P6(deps({ services: spy, runNumber: 555, runId: "R555" }));
    const tail = log.slice(log.lastIndexOf("delete") - 0);
    const lastDelete = log.lastIndexOf("delete");
    const firstDeactivate = log.indexOf("deactivate");
    const lastDeactivate = log.lastIndexOf("deactivate");
    expect(lastDelete).toBeLessThan(firstDeactivate);
    expect(lastDeactivate).toBeLessThan(log.lastIndexOf("close"));
    expect(log.filter((x) => x === "deactivate")).toHaveLength(2);
    expect(tail.length).toBeGreaterThan(0);
  });
  it("nothing is hard-deleted: the production collection, labours, seasons and rates only grow", async () => {
    await populate();
    const sizes = () => [db.production.size, db.labours.size, db.seasons.size, db.rates.length, db.attendance.size, db.payments.size];
    const before = sizes();
    const r = await P6();
    const after = sizes();
    after.forEach((n, i) => expect(n).toBeGreaterThanOrEqual(before[i]));
    expect(after[1] - before[1]).toBe(2);
    expect(after[2] - before[2]).toBe(2);
    expect(r.ledger.filter((x) => x.collection === "production").length).toBeGreaterThanOrEqual(2);
  });
  it("P6-IMPACT: counts +2/+2/+2/+2, counter +2, and every money total returns to its original NON-ZERO value", async () => {
    await populate();
    const money = async () => JSON.stringify([(await services.salary.getSalarySummary()).summary.total, (await services.balance.listBalances()).totals]);
    const m0 = await money();
    const base = JSON.parse(m0);
    expect(base[0].paid + base[0].received + base[0].overpaid).toBeGreaterThan(0); // the baseline is not trivially zero
    const seq0 = db.counters.labour;
    const r = await P6();
    expect(byId(r, "P6-IMPACT").status).toBe("PASS");
    expect(byId(r, "P6-IMPACT").detail).toMatch(/labours\.total \+2, labours\.inactive \+2, labours\.patlavale \+2, balances\.labours \+2; labour id counter \+2/);
    expect(JSON.parse(await money())[0]).toEqual(base[0]); // salary totals identical
    expect(JSON.parse(await money())[1].earned).toBe(base[1].earned);
    expect(db.counters.labour - seq0).toBe(2);
  });
  it("P6-IMPACT FAILS when money does not return (a live entry survives) and P6-T FAILS too", async () => {
    await populate();
    const sticky = { ...services, production: { ...services.production, deleteEntry: async (id, body, ...a) => { if (body.reason === H.FIXTURE.reasons.tidy && !sticky.once) { sticky.once = true; return {}; } return services.production.deleteEntry(id, body, ...a); } } }; // one TIDY delete silently does nothing
    const r = await P6(deps({ services: sticky, runNumber: 555, runId: "R555" }));
    expect(byId(r, "P6-T").status).toBe("FAIL");
    expect(byId(r, "P6-IMPACT").status).toBe("FAIL");
    expect(r.verdict).toBe(1);
  });
  it("P6-IMPACT FAILS when an extra worker is created (counts and counter move by more than 2)", async () => {
    await populate();
    let extra = false;
    const sneaky = { ...services, labour: { ...services.labour, createLabour: async (...a) => { const out = await services.labour.createLabour(...a); if (!extra && /P6-T2/.test(a[0].name)) { extra = true; await services.labour.createLabour({ labourType: "BIGARI", name: "Sneaky", mobile: "9822222222", village: "V", joiningDate: "2026-01-01", status: "ACTIVE", dailyRate: 1 }, OWNER); } return out; } } };
    const r = await P6(deps({ services: sneaky, runNumber: 555, runId: "R555" }));
    expect(byId(r, "P6-IMPACT").status).toBe("FAIL");
  });
  it("P6-ISO FAILS if a D1 fixture, the D1 season, a D2 fixture, another worker or another counter changes", async () => {
    const cases = {
      "D1 season": () => { const s = [...db.seasons.values()].find((x) => /D1-SEASON/.test(x.name)); s.revision += 1; },
      "D1 fixture": () => { const l = [...db.labours.values()].find((x) => /D1-A/.test(x.name)); l.village = "changed"; },
      "D2 fixture": () => { const l = [...db.labours.values()].find((x) => /D2-NORATE/.test(x.name)); l.village = "changed"; },
      "other worker": () => { const l = [...db.labours.values()].find((x) => x.name === "Real Worker"); l.village = "changed"; },
      "other counter": () => { db.counters["bill:FY"] = (db.counters["bill:FY"] ?? 0) + 1; },
      "an earlier production entry": () => { [...db.production.values()].find((e) => e.teamId && !/P6/.test(db.labours.get(e.teamId)?.name ?? ""))?.history.push({ x: 1 }); },
    };
    for (const [label, mutate] of Object.entries(cases)) {
      db.reset();
      await populate();
      let fired = false;
      const spy = { ...services, production: { ...services.production, saveDay: async (...a) => { if (!fired) { fired = true; mutate(); } return services.production.saveDay(...a); } } };
      const r = await P6(deps({ services: spy, runNumber: 555, runId: "R555" }));
      expect(byId(r, "P6-ISO").status, label).toBe("FAIL");
    }
  });
  it("D1 and D2 fixtures are untouched: their own records are identical after P6", async () => {
    await populate();
    const mine = () => JSON.stringify([[...db.labours.values()].filter((l) => /D[12]-/.test(l.name)), [...db.attendance.values()], [...db.maap.values()], [...db.payments.values()], [...db.seasons.values()].filter((s) => /D1-/.test(s.name)), db.rates.filter((x) => /^L-0(1|2[01])/.test(x.labourId))]);
    const before = mine();
    await P6();
    expect(mine()).toBe(before);
  });
});

describe("P6 interrupted and failed runs (nothing is retried, created or hard-deleted; recovery is reported)", () => {
  const P6 = (d) => H.runPhase("p6", d ?? deps({ runNumber: 555, runId: "R555" }), { windowStart: "2001-06-01", flags: {} });
  const p6Labours = () => [...db.labours.values()].filter((l) => /P6-T/.test(l.name));
  it("the second worker cannot be created: the first is still tidied (INACTIVE), no season exists, and the run is a failure", async () => {
    const real = services.labour.createLabour;
    const broken = { ...services, labour: { ...services.labour, createLabour: async (...a) => { if (/P6-T2/.test(a[0].name)) throw new Error("connection lost"); return real(...a); } } };
    const r = await P6(deps({ services: broken, runNumber: 555, runId: "R555" }));
    expect(byId(r, "P6-0").status).toBe("FAIL");
    expect(["P6-1", "P6-2", "P6-3", "P6-4"].map((id) => byId(r, id).status)).toEqual(["SKIPPED", "SKIPPED", "SKIPPED", "SKIPPED"]);
    expect(p6Labours()).toHaveLength(1);
    expect(p6Labours()[0].status).toBe("INACTIVE");
    expect(byId(r, "P6-T").status).toBe("PASS");
    expect(byId(r, "P6-IMPACT").status).toBe("PASS"); // impact is judged against what was actually created (1 worker)
    expect(r.verdict).toBe(1);
  });
  it("setup dies after the seasons exist but before any entry: seasons are closed, workers deactivated, nothing live", async () => {
    const dead = { ...services, production: { ...services.production, saveDay: async () => { throw new Error("connection lost"); } } };
    const r = await P6(deps({ services: dead, runNumber: 555, runId: "R555" }));
    expect(byId(r, "P6-0").status).toBe("FAIL");
    expect(p6Labours().map((l) => l.status)).toEqual(["INACTIVE", "INACTIVE"]);
    expect([...db.seasons.values()].map((x) => x.status)).toEqual(["CLOSED", "CLOSED"]);
    expect(db.production.size).toBe(0);
    expect(byId(r, "P6-T").status).toBe("PASS");
    expect(byId(r, "P6-ISO").status).toBe("PASS");
  });
  it("a season left CLOSED by a failed step is reopened by the tidy BEFORE entries are deleted, then closed again", async () => {
    const real = services.season.updateSeason;
    let skipped = false;
    const flaky = { ...services, season: { ...services.season, updateSeason: async (id, patch, ...a) => { if (patch.status === "OPEN" && !skipped && /P6-S2/.test(db.seasons.get(id)?.name ?? "")) { skipped = true; throw new Error("connection lost"); } return real(id, patch, ...a); } } };
    const r = await P6(deps({ services: flaky, runNumber: 555, runId: "R555" }));
    expect(skipped).toBe(true);
    expect(byId(r, "P6-3").status).toBe("FAIL"); // the failed reopen is reported where it happened
    expect(byId(r, "P6-T").status).toBe("PASS"); // and the tidy repaired it with normal services
    expect([...db.seasons.values()].filter((x) => /P6-S/.test(x.name)).map((x) => x.status)).toEqual(["CLOSED", "CLOSED"]);
    expect([...db.production.values()].filter((e) => !e.isDeleted).length).toBe(0);
  });
  it("a season shortened by a race and left that way is restored to its original end date by the tidy", async () => {
    const real = services.production.saveDay;
    let done = false;
    const shrinker = { ...services, production: { ...services.production, saveDay: async (date, ...a) => { const out = await real(date, ...a); if (!done && date === "2001-06-07") { done = true; const s = [...db.seasons.values()].find((x) => /P6-S1/.test(x.name)); s.endDate = "2001-06-10"; } return out; } } };
    const r = await P6(deps({ services: shrinker, runNumber: 555, runId: "R555" }));
    expect(done).toBe(true);
    const s1 = [...db.seasons.values()].find((x) => /P6-S1/.test(x.name));
    expect(s1.endDate).toBe("2001-06-30");
    expect(s1.status).toBe("CLOSED");
    expect(byId(r, "P6-T").status).toBe("PASS");
  });
  it("a tidy step that fails is REPORTED with what remains; the other steps still run; nothing is retried or hard-deleted", async () => {
    const real = services.production.deleteEntry;
    let n = 0;
    const flaky = { ...services, production: { ...services.production, deleteEntry: async (id, ...a) => { n += 1; if (n === 3) throw new Error("connection lost"); return real(id, ...a); } } };
    const sizeBefore = () => db.production.size;
    const r = await P6(deps({ services: flaky, runNumber: 555, runId: "R555" }));
    const t = byId(r, "P6-T");
    expect(t.status).toBe("FAIL");
    expect(t.detail).toMatch(/tidy incomplete, NOTHING was retried or removed: .*delete entry .*connection lost/);
    expect(byId(r, "P6-IMPACT").status).toBe("FAIL");
    expect([...db.production.values()].filter((e) => !e.isDeleted).length).toBeGreaterThan(0); // honestly left live, not hidden
    expect(sizeBefore()).toBe(db.production.size);
    expect(n).toBeGreaterThan(3); // later entries were still attempted
  });
  it("a failed race test (entry left outside its season) does not stop the tidy; failing evidence stays stored (soft delete only)", async () => {
    const unguarded = {
      ...services,
      production: { ...services.production, saveDay: async (date, { rows }) => { for (const row of rows) db.production.set(`p-${date}-${row.teamId}`, { _id: `p-${date}-${row.teamId}`, teamId: row.teamId, seasonId: [...db.seasons.keys()][0], date, numberOfMaaps: row.maaps, isDeleted: false }); [...db.seasons.values()][0].revision += 1; return {}; } },
      season: { ...services.season, updateSeason: async (id, patch) => { Object.assign(db.seasons.get(id), patch, { revision: db.seasons.get(id).revision + 1 }); return {}; } },
    };
    const r = await P6(deps({ services: unguarded, runNumber: 555, runId: "R555" }));
    expect(byId(r, "P6-1").status).toBe("FAIL");
    expect(byId(r, "P6-T")).toBeDefined(); // the tidy ran and reported
    expect(r.verdict).toBe(1);
    expect(db.production.size).toBeGreaterThan(2); // nothing was removed
  });
  it("after ANY interrupted or failed run a new P6 is blocked by P6-LOCK and writes nothing", async () => {
    const dead = { ...services, production: { ...services.production, saveDay: async () => { throw new Error("connection lost"); } } };
    await P6(deps({ services: dead, runNumber: 555, runId: "R555" }));
    const before = snapshot();
    const again = await P6(deps({ runNumber: 556, runId: "R556" }));
    expect(byId(again, "P6-LOCK").status).toBe("INCONCLUSIVE");
    expect(again.results.slice(1).every((x) => x.status === "SKIPPED")).toBe(true);
    expect(again.ledger).toEqual([]);
    expect(snapshot()).toBe(before);
  });
  it("a run killed before the tidy (only the workers exist) also blocks a retry, and there is no automatic repair", async () => {
    await services.labour.createLabour({ labourType: "PATLAVALE", name: `${H.FIXTURE.prefix} R9 P6-T1`, mobile: "9009000921", village: "ZZ", joiningDate: "2001-06-01", status: "ACTIVE", ratePer1000PayableBricks: 700 }, OWNER);
    const before = snapshot();
    const again = await P6();
    expect(byId(again, "P6-LOCK").status).toBe("INCONCLUSIVE");
    expect(snapshot()).toBe(before);
  });
  it("the harness source performs no hard delete, index change or direct write (soft deletes go through the app's services)", () => {
    const code = readFileSync(new URL("../scripts/lib/phase1cHarness.js", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toMatch(/deleteOne|deleteMany|\.remove\(|\.drop|createIndex|syncIndexes|updateMany|updateOne|replaceOne|bulkWrite|insertMany|findOneAnd|\$unset|\$rename/);
    expect([...code.matchAll(/^import .* from "(.+)";/gm)].map((m) => m[1])).toEqual(["./patlavaleHarness.js"]);
  });
});
