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

// Read-only D1 fixture verification. FAKE-DATABASE tests only (plus the real BSON ObjectId class): they prove the harness's guards, gates and scenario logic. The in-memory store has no
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
const run = (phase, flags = {}, d = deps()) => H.runPhase(phase, d, { windowStart: "2001-03-01", flags });
const V = await import("../scripts/lib/d1VerifyLib.js");
const strictReader = () => V.makeReader(nativeRead, toObjectId);
const verify = async (raw = nativeRead, opts = {}) => {
  const { read, reads } = V.makeReader(raw, toObjectId);
  const out = await V.runVerification(read, opts);
  return { ...out, reads };
};
const by = (r, id) => r.results.find((x) => x.id === id);
const statusOf = (r) => Object.fromEntries(r.results.map((x) => [x.id, x.status]));
// D1 in the fake, with the labour counter pre-set so the fixtures are L-014..L-019 exactly as on Atlas.
const seedD1 = async () => {
  db.counters.labour = 13;
  const r = await run("d1");
  expect(r.results.filter((x) => x.status !== "PASS")).toEqual([]);
};
beforeEach(() => db.reset());

describe("read-only D1 verification: state produced by a full D1 run", () => {
  it("passes every check on the strict BSON reader and the fixtures are L-014..L-019", async () => {
    await seedD1();
    const r = await verify();
    expect(statusOf(r)).toEqual({ V0: "PASS", V1: "PASS", V2: "PASS", V3: "PASS", V4: "PASS", V5: "PASS", V6: "PASS", V7: "PASS", V8: "PASS", V9: "PASS", V10: "PASS", CONTEXT: "INFO" });
    expect(r.facts.ids.sort()).toEqual(["L-014", "L-015", "L-016", "L-017", "L-018", "L-019"]);
    expect(V.verdictOf(r.results)).toBe(0);
  });
  it("writes nothing: the whole fake database is identical afterwards, and only find-style reads were counted", async () => {
    await seedD1();
    const before = snapshot();
    const r = await verify();
    expect(snapshot()).toBe(before);
    expect(Object.keys(r.reads).sort()).toEqual(["attendance", "counters", "labours", "maap", "payments", "production", "rates", "seasons"]);
  });
  it("a raw hex-string read finds nothing (the Atlas symptom), so the verifier must and does convert", async () => {
    await seedD1();
    const row = db.payments.values().next().value;
    expect(await nativeRead("payments", { _id: String(row._id) })).toEqual([]);
    expect((await strictReader().read("payments", { _id: String(row._id) })).length).toBe(1);
    const noConversion = V.makeReader(nativeRead, (hex) => hex); // identity: what the old harness effectively did
    const r = await V.runVerification(noConversion.read);
    expect(by(r, "V8").status).toBe("FAIL");
  });
  it("the report shows exact counts and fields, hides every mobile number, and claims no before/after equality", async () => {
    await seedD1();
    const r = await verify();
    const text = V.formatVerifyReport(r, { dbName: EXPECTED_DB, host: EXPECTED_CLUSTER_HOST }).join("\n");
    expect(text).toMatch(/\[PASS\] V6/);
    expect(text).toMatch(/BOOKING_ADVANCE 10000 paise 2001-03-03 isDeleted=true/);
    expect(text).toMatch(/2001-03-01\.\.2001-04-29 CLOSED/);
    expect(text).toMatch(/0 writes/);
    expect(text).toMatch(/No before\/after equality is claimed/);
    for (const l of db.labours.values()) expect(text).not.toContain(l.mobile);
    expect(text).not.toMatch(/\b\d{10}\b/);
    expect(text).not.toMatch(/mongodb(\+srv)?:\/\//);
  });
  it("labour mobile numbers never reach the checks: the reader drops them", async () => {
    await seedD1();
    const rows = await strictReader().read("labours", {});
    expect(rows.length).toBe(6);
    expect(rows.every((l) => !("mobile" in l) && l.mobileFormatOk === true)).toBe(true);
  });
});

describe("read-only D1 verification: missing, duplicated or altered records FAIL", () => {
  const failsWith = async (mutate, id, text) => {
    await seedD1();
    mutate();
    const r = await verify();
    expect(by(r, id).status).toBe("FAIL");
    if (text) expect(by(r, id).problems.join(" ")).toMatch(text);
    expect(V.verdictOf(r.results)).toBe(1);
    return r;
  };
  it("a missing fixture worker fails V0 and the dependent checks are SKIPPED, exit 1", async () => {
    const r = await failsWith(() => db.labours.delete("L-016"), "V0", /D1-P: expected exactly 1 labour document, found 0/);
    expect(by(r, "V1").status).toBe("SKIPPED");
  });
  it("a duplicated fixture worker fails V0", async () => {
    await failsWith(() => db.labours.set("L-099", { ...db.labours.get("L-014"), _id: "L-099" }), "V0", /found 2/);
  });
  it("unexpected ids fail V0", async () => {
    await failsWith(() => { const l = db.labours.get("L-019"); db.labours.delete("L-019"); db.labours.set("L-020", { ...l, _id: "L-020" }); }, "V0", /fixture ids are/);
  });
  it("a worker that is not INACTIVE, or whose village changed, fails V1", async () => {
    await failsWith(() => { db.labours.get("L-015").status = "ACTIVE"; }, "V1", /expected INACTIVE/);
    db.reset();
    await failsWith(() => { db.labours.get("L-015").village = "ZZ changed"; }, "V1", /village/);
  });
  it("a missing or duplicated rate row fails V2", async () => {
    await failsWith(() => { const i = db.rates.findIndex((r) => r.labourId === "L-014"); db.rates.splice(i, 1); }, "V2", /expected exactly 6 rate rows/);
    db.reset();
    await failsWith(() => db.rates.push({ ...db.rates[0], _id: new OID().toString(), effectiveFrom: "2001-04-01" }), "V2", /found 2/);
  });
  it("a rate row out of step with the joining date fails V2", async () => {
    await failsWith(() => { db.rates.find((r) => r.labourId === "L-014").effectiveFrom = "2001-03-02"; }, "V2", /first rate effective/);
  });
  it("attendance: missing record, wrong status, or lost history fails V3", async () => {
    await failsWith(() => db.attendance.clear(), "V3", /found 0/);
    db.reset();
    await failsWith(() => { [...db.attendance.values()][0].status = "PRESENT"; }, "V3", /expected ABSENT/);
    db.reset();
    await failsWith(() => { [...db.attendance.values()][0].history = []; }, "V3", /exactly one PRESENT -> ABSENT/);
  });
  it("Maapvali: missing entry, an entry that is not deleted, or a missing delete reason fails V4", async () => {
    await failsWith(() => db.maap.delete([...db.maap.keys()][0]), "V4", /found 1/);
    db.reset();
    await failsWith(() => { [...db.maap.values()][0].isDeleted = false; }, "V4", /isDeleted is false/);
    db.reset();
    await failsWith(() => { [...db.maap.values()][1].deletedReason = null; }, "V4", /deletedReason/);
  });
  it("production: missing, undeleted, or pointing at another season fails V5", async () => {
    await failsWith(() => db.production.clear(), "V5", /found 0/);
    db.reset();
    await failsWith(() => { [...db.production.values()][0].isDeleted = false; }, "V5", /isDeleted is false/);
  });
  it("payments: the Bayana missing, un-voided or altered fails V6", async () => {
    await failsWith(() => { const k = [...db.payments.entries()].find(([, p]) => p.type === "BOOKING_ADVANCE")[0]; db.payments.delete(k); }, "V6", /found 0|found 2/);
    db.reset();
    await failsWith(() => { [...db.payments.values()].find((p) => p.type === "BOOKING_ADVANCE").isDeleted = false; }, "V6", /isDeleted is false/);
    db.reset();
    await failsWith(() => { [...db.payments.values()].find((p) => p.type === "BOOKING_ADVANCE").amountPaise = 99; }, "V6", /expected BOOKING_ADVANCE 10000/);
  });
  it("season: missing, duplicated, or still OPEN fails V7", async () => {
    await failsWith(() => db.seasons.clear(), "V7", /found 0/);
    db.reset();
    await failsWith(() => { const s = [...db.seasons.values()][0]; db.seasons.set("dup", { ...s, _id: new OID().toString() }); }, "V7", /found 2/);
    db.reset();
    await failsWith(() => { [...db.seasons.values()][0].status = "OPEN"; }, "V7", /expected CLOSED/);
  });
  it("V9 accepts the intentionally retained attendance record (L-014, 2001-03-21, ABSENT, revision 2, one PRESENT->ABSENT entry)", async () => {
    await seedD1();
    const att = [...db.attendance.values()];
    expect(att).toHaveLength(1);
    expect(att[0]).toMatchObject({ labourId: "L-014", date: "2001-03-21", status: "ABSENT", revision: 2 });
    expect(att[0].history).toHaveLength(1);
    const r = await verify();
    expect(by(r, "V9").status).toBe("PASS");
    expect(by(r, "V3").status).toBe("PASS");
    expect(by(r, "V9").lines.join(" ")).toMatch(/retained attendance record .* present.*unexpected attendance 0/);
  });
  it("V9 and V3 fail when the retained attendance record is deleted", async () => {
    await seedD1();
    db.attendance.clear();
    const r = await verify();
    expect(by(r, "V3").status).toBe("FAIL");
    expect(by(r, "V9").status).toBe("FAIL");
    expect(by(r, "V9").problems.join(" ")).toMatch(/retained attendance record .* is missing|could not complete|missing/);
  });
  it("an unexpected extra live attendance record fails V9 and V3 (even if ABSENT)", async () => {
    await seedD1();
    const a = [...db.attendance.values()][0];
    db.attendance.set("att-extra", { ...a, _id: new OID().toString(), labourId: "L-015", date: "2001-03-22" });
    const r = await verify();
    expect(by(r, "V9").status).toBe("FAIL");
    expect(by(r, "V9").problems.join(" ")).toMatch(/1 unexpected attendance record/);
    expect(by(r, "V3").status).toBe("FAIL");
  });
  it("a PRESENT attendance record fails V9 and V3", async () => {
    await seedD1();
    [...db.attendance.values()][0].status = "PRESENT";
    const r = await verify();
    expect(by(r, "V9").status).toBe("FAIL");
    expect(by(r, "V9").problems.join(" ")).toMatch(/PRESENT/);
    expect(by(r, "V3").status).toBe("FAIL");
  });
  it("V9 still fails for each live Maapvali entry, production entry or payment", async () => {
    for (const [store, pat] of [["maap", /live maap/], ["production", /live production/], ["payments", /live payments/]]) {
      db.reset();
      await failsWith(() => { [...db[store].values()][0].isDeleted = false; }, "V9", pat);
    }
  });
  it("a missing or too-low labour counter fails V10", async () => {
    await failsWith(() => { db.counters.labour = 10; }, "V10", /below the highest fixture id/);
    db.reset();
    await failsWith(() => { delete db.counters.labour; }, "V10", /found 0/);
  });
  it("an empty database FAILs (nothing found is never a pass)", async () => {
    const r = await verify();
    expect(by(r, "V0").status).toBe("FAIL");
    expect(V.verdictOf(r.results)).toBe(1);
  });
  it("a counter above the fixtures is reported, not failed, and other counters are listed without a baseline claim", async () => {
    await seedD1();
    db.counters.labour = 20;
    db.counters["bill-FY"] = 7;
    const r = await verify();
    expect(by(r, "V10").status).toBe("PASS");
    expect(by(r, "V10").lines.join(" ")).toMatch(/another worker was created after D1/);
    expect(by(r, "CONTEXT").lines.join(" ")).toMatch(/bill-FY=7/);
  });
});

describe("read-only D1 verification: guards, reader and source", () => {
  const URI = `mongodb+srv://u:SECRETPASS@${EXPECTED_CLUSTER_HOST}/${EXPECTED_DB}?retryWrites=true`;
  const base = ["--confirm-db", EXPECTED_DB, "--confirm-host", EXPECTED_CLUSTER_HOST];
  const g = (argv, env = { MONGODB_URI: URI, NODE_ENV: "development" }) => V.checkVerifyGuards({ argv, env });
  it("accepts only the two confirmations (and an optional window start)", () => {
    expect(g(base)).toMatchObject({ ok: true, dbName: EXPECTED_DB, windowStart: "2001-03-01" });
    expect(g([...base, "--window-start", "2001-05-01"]).windowStart).toBe("2001-05-01");
  });
  it("refuses every write or rerun flag, other phases, missing or wrong confirmations, wrong database or host, production", () => {
    for (const bad of [["--allow-rerun"], ["--phase", "d1"], ["--i-understand-this-writes-test-data"], ["--accept-permanent-numbering-lock"], ["--allow-direct-fixture-insert"], ["extra"], ["--phase", "d2"]]) {
      expect(g([...base, ...bad]).ok, bad.join(" ")).toBe(false);
    }
    expect(g(["--confirm-host", EXPECTED_CLUSTER_HOST]).ok).toBe(false);
    expect(g(["--confirm-db", EXPECTED_DB]).ok).toBe(false);
    expect(g(["--confirm-db", "aayush_carting", "--confirm-host", EXPECTED_CLUSTER_HOST]).ok).toBe(false);
    expect(g(base, { MONGODB_URI: URI.replace(EXPECTED_DB, "aayush_carting"), NODE_ENV: "development" }).ok).toBe(false);
    expect(g(base, { MONGODB_URI: URI.replace(EXPECTED_CLUSTER_HOST, "other.mongodb.net"), NODE_ENV: "development" }).ok).toBe(false);
    expect(g(base, { MONGODB_URI: URI, NODE_ENV: "production" }).ok).toBe(false);
    expect(g(base, {}).ok).toBe(false);
    expect(g([...base, "--window-start", "2001-02-30"]).ok).toBe(false);
  });
  it("a refusal never echoes the connection string or password", () => {
    const r = g(["--confirm-db", "x", "--confirm-host", "y"]);
    expect(JSON.stringify(r)).not.toMatch(/SECRETPASS|mongodb\+srv/);
  });
  it("the reader needs toObjectId, only reads whitelisted collections (no settings, bills or users)", async () => {
    expect(() => V.makeReader(nativeRead)).toThrow(/toObjectId/);
    const { read } = strictReader();
    for (const c of ["settings", "bills", "users", "system.indexes"]) await expect(read(c)).rejects.toThrow(/not allowed/);
  });
  it("the scripts contain no write, delete, index or rerun operation and use only find()", () => {
    const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const forbidden = /deleteOne|deleteMany|\.remove\(|\.drop|createIndex|syncIndexes|updateOne|updateMany|replaceOne|bulkWrite|insertOne|insertMany|findOneAnd|\.save\(|\.create\(|\$unset|\$rename|\$set|\$inc|allow-rerun|rename/;
    for (const f of ["../scripts/verifyD1Fixtures.js", "../scripts/lib/d1VerifyLib.js"]) {
      const code = strip(readFileSync(new URL(f, import.meta.url), "utf8"));
      expect(code, f).not.toMatch(forbidden);
    }
    const script = strip(readFileSync(new URL("../scripts/verifyD1Fixtures.js", import.meta.url), "utf8"));
    expect(script).toMatch(/collection\.find\(filter\)\.toArray\(\)/);
    expect(script).toMatch(/new mongoose\.Types\.ObjectId\(hex\)/);
    expect(script).not.toMatch(/services\/|runInTransaction/);
    expect([...readFileSync(new URL("../scripts/lib/d1VerifyLib.js", import.meta.url), "utf8").matchAll(/^import .* from "(.+)";/gm)].map((m) => m[1]).sort()).toEqual(["./patlavaleHarness.js", "./phase1cHarness.js"]);
  });
  it("the script refuses before any connection when run without confirmations (exit 2, no secrets printed)", async () => {
    const { spawnSync } = await import("node:child_process");
    const res = spawnSync(process.execPath, ["scripts/verifyD1Fixtures.js"], { cwd: new URL("..", import.meta.url).pathname, env: { PATH: process.env.PATH, MONGODB_URI: URI, NODE_ENV: "development" }, encoding: "utf8", timeout: 20000 });
    expect(res.status).toBe(2);
    expect(res.stdout + res.stderr).not.toMatch(/SECRETPASS|mongodb\+srv/);
  });
});
