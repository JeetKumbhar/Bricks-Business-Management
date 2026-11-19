import mongoose from "mongoose";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.NODE_ENV = "test";
  process.env.BCRYPT_ROUNDS = "4";
  process.env.CLIENT_ORIGIN = "http://localhost:5173";
  process.env.JWT_SECRET = "unit-test-secret-that-is-long-enough-0123456789";
});

// No database in tests: real Mongoose schemas validate; an in-memory store replaces only the storage calls.
const { db, makeAttendanceModel, makeCounterModel, makeLabourModel, makeMaapEntryModel, makePaymentModel, makeProductionEntryModel, makeRateModel, makeSeasonModel } = await import("./helpers/memoryDb.js");
const users = vi.hoisted(() => ({ list: [] }));

vi.mock("../config/db.js", () => ({ getDbStatus: async () => ({ status: "connected", name: "test" }) }));
vi.mock("../models/User.js", () => ({
  default: { findById: (id) => ({ lean: async () => users.list.find((u) => String(u._id) === String(id)) ?? null }) },
}));
vi.mock("../models/Counter.js", () => ({ default: makeCounterModel() }));
vi.mock("../utils/transaction.js", () => ({ runInTransaction: (work) => db.transaction(() => work(null)) }));
vi.mock("../models/Labour.js", async (importOriginal) => ({ default: makeLabourModel((await importOriginal()).default) }));
vi.mock("../models/LabourRateHistory.js", async (importOriginal) => ({ default: makeRateModel((await importOriginal()).default) }));
vi.mock("../models/Attendance.js", () => ({ default: makeAttendanceModel() }));
vi.mock("../models/MaapEntry.js", () => ({ default: makeMaapEntryModel() }));
vi.mock("../models/Season.js", async (importOriginal) => ({ default: makeSeasonModel((await importOriginal()).default) }));
vi.mock("../models/ProductionEntry.js", () => ({ default: makeProductionEntryModel() }));
vi.mock("../models/Payment.js", async (importOriginal) => ({ default: makePaymentModel((await importOriginal()).default) }));

const { createApp } = await import("../app.js");
const { signAccessToken } = await import("../services/auth.service.js");
const { buildLedger, summarizeAccount, summarizeWork } = await import("../services/salaryCalculations.js");
const { addDays, todayBusinessDate } = await import("../utils/dates.js");

const ORIGIN = "http://localhost:5173";
let today = todayBusinessDate();
const daysAgo = (n) => addDays(today, -n);

const addUser = (role = "OWNER", name = "Ramesh Patel") => {
  const user = { _id: new mongoose.Types.ObjectId().toString(), name, email: `${role.toLowerCase()}@example.com`, role, isActive: true, tokenVersion: 0 };
  users.list.push(user);
  return { user, cookie: `brickpro_token=${signAccessToken(user)}` };
};

let app;
let owner;
let manager;
const send = (method, url, cookie, body) => {
  const req = request(app)[method](url).set("Origin", ORIGIN);
  if (cookie) req.set("Cookie", cookie);
  return body === undefined ? req : req.send(body);
};
const asOwner = (method, url, body) => send(method, url, owner.cookie, body);

let mobileSeq = 0;
const makeLabour = async (labourType, o = {}) => {
  const rate = labourType === "PATLAVALE" ? { ratePer1000PayableBricks: 650 } : labourType === "MAAPVALI" ? { ratePerFourMaaps: 250 } : { dailyRate: 650 };
  const res = await asOwner("post", "/api/labours", { labourType, name: `Worker ${mobileSeq + 1}`, mobile: `98100${String(10000 + (mobileSeq += 1))}`, village: "Sinnar", joiningDate: daysAgo(60), ...rate, ...o });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.data;
};

const D = (n) => daysAgo(n);
const attend = async (w, d, status = "PRESENT") => expect((await asOwner("put", `/api/attendance/${D(d)}`, { entries: [{ labourId: w.id, status }], reason: "Late entry" })).status).toBe(200);
const balanceOf = async (w) => (await asOwner("get", `/api/labours/${w.id}/balance`)).body.data;
const dropRates = (w) => {
  for (let i = db.rates.length - 1; i >= 0; i -= 1) if (db.rates[i].labourId === w.id) db.rates.splice(i, 1);
};
const snapshot = () => JSON.stringify([[...db.attendance.values()], [...db.maap.values()], [...db.production.values()], [...db.payments.values()], [...db.labours.values()], db.rates]);

beforeEach(() => {
  today = todayBusinessDate();
  db.reset();
  users.list.length = 0;
  mobileSeq = 0;
  owner = addUser("OWNER");
  app = createApp();
});
afterEach(() => vi.useRealTimers());

// ---------------------------------------------------------------------------
describe("characterization: legacy Bigari attendance with no rate-history row (D2, pinned BEFORE any change)", () => {
  it("balance and salary still count such days as zero earnings (values unchanged) but now FLAG them", async () => {
    const w = await makeLabour("BIGARI");
    await attend(w, 5);
    await attend(w, 4);
    dropRates(w);
    const b = await balanceOf(w);
    expect(b.earned).toBe(0);
    expect(b.work.workDays).toBe(2);
    expect(b).toMatchObject({ missingRateDays: 2, incomplete: true });
    const all = (await asOwner("get", "/api/balances")).body;
    expect(all.meta.totals).toMatchObject({ incomplete: true, missingRateLabours: 1, earned: 0 });
    const sal = (await asOwner("get", "/api/salary")).body;
    const row = sal.data.find((r) => r.id === w.id);
    expect(row.season.earned).toBe(0);
    expect(row).toMatchObject({ incomplete: true, missingRate: { days: 2, daysInPeriod: 2, firstDate: D(5) } });
    expect(sal.meta.summary.total).toMatchObject({ incomplete: true, missingRateAccounts: 1 });
    const st = (await asOwner("get", `/api/salary/${w.id}`)).body.data;
    expect(st.incomplete).toBe(true);
    expect(st.lines.filter((l) => l.kind === "ATTENDANCE").every((l) => l.rate === null && l.rateMissing === true && l.earned === 0)).toBe(true);
  });

  it("a worker WITH rates carries no flag, and the flag never changes any stored record", async () => {
    const ok = await makeLabour("BIGARI");
    await attend(ok, 5);
    const bad = await makeLabour("BIGARI");
    await attend(bad, 5);
    dropRates(bad);
    const before = snapshot();
    const b = await balanceOf(ok);
    expect(b).toMatchObject({ missingRateDays: 0, incomplete: false, earned: 650 });
    await balanceOf(bad);
    await asOwner("get", "/api/salary");
    expect(snapshot()).toBe(before);
    expect((await asOwner("get", "/api/balances")).body.meta.totals).toMatchObject({ incomplete: true, missingRateLabours: 1 });
  });

  it("with a rate row present the same attendance is priced normally (650 x 2 = 1,300)", async () => {
    const w = await makeLabour("BIGARI");
    await attend(w, 5);
    await attend(w, 4);
    expect((await balanceOf(w)).earned).toBe(1300);
  });

  it("a date before the first rate row uses the first rate", async () => {
    const w = await makeLabour("BIGARI", { joiningDate: D(40) });
    await attend(w, 30);
    expect((await balanceOf(w)).earned).toBe(650);
  });
});

describe("characterization: records without isDeleted are not counted", () => {
  it("a Maapvali entry stored without isDeleted is invisible to the balance", async () => {
    const w = await makeLabour("MAAPVALI");
    expect((await asOwner("put", `/api/maap-entries/day/${D(3)}`, { rows: [{ labourId: w.id, maaps: 8 }], reason: "Late entry" })).status).toBe(200);
    expect((await balanceOf(w)).earned).toBe(500);
    for (const r of db.maap.values()) delete r.isDeleted;
    expect((await balanceOf(w)).earned).toBe(0);
  });
});

describe("D1: joining-date edit is checked against existing records (409 names the earliest; nothing is written)", () => {
  const patchJoin = (w, joiningDate) => asOwner("patch", `/api/labours/${w.id}`, { joiningDate });
  const rateRows = (w) => db.rates.filter((r) => r.labourId === w.id);

  it("a valid EARLIER correction is accepted and moves the first rate row with it", async () => {
    const w = await makeLabour("BIGARI", { joiningDate: D(30) });
    await attend(w, 20);
    const res = await patchJoin(w, D(40));
    expect(res.status).toBe(200);
    expect(res.body.data.joiningDate).toBe(D(40));
    expect(rateRows(w)[0].effectiveFrom).toBe(D(40));
  });

  it("a valid LATER correction up to the earliest record day is accepted", async () => {
    const w = await makeLabour("BIGARI", { joiningDate: D(30) });
    await attend(w, 20);
    expect((await patchJoin(w, D(20))).status).toBe(200);
  });

  it("a later date after existing attendance is 409, names the earliest record, and writes nothing", async () => {
    const w = await makeLabour("BIGARI", { joiningDate: D(30) });
    await attend(w, 20);
    await attend(w, 10);
    const before = snapshot();
    const res = await patchJoin(w, D(5));
    expect(res.status).toBe(409);
    expect(res.body.message ?? JSON.stringify(res.body)).toContain(D(20));
    expect(snapshot()).toBe(before);
  });

  it("covers Maapvali entries, Patlavale production entries and non-Bayana payments", async () => {
    const m = await makeLabour("MAAPVALI", { joiningDate: D(30) });
    expect((await asOwner("put", `/api/maap-entries/day/${D(12)}`, { rows: [{ labourId: m.id, maaps: 4 }], reason: "Late entry" })).status).toBe(200);
    expect((await patchJoin(m, D(5))).status).toBe(409);
    expect((await asOwner("post", "/api/seasons", { name: "Season 2026-27", startDate: D(90) })).status).toBe(201);
    const t = await makeLabour("PATLAVALE", { joiningDate: D(30) });
    expect((await asOwner("put", `/api/production-entries/day/${D(11)}`, { rows: [{ teamId: t.id, maaps: 4 }], reason: "Late entry" })).status).toBe(200);
    expect((await patchJoin(t, D(5))).status).toBe(409);
    const p = await makeLabour("BIGARI", { joiningDate: D(30) });
    expect((await asOwner("post", "/api/payments", { recipientId: p.id, type: "SALARY_PAYMENT", amount: 100, date: D(9) })).status).toBe(201);
    const res = await patchJoin(p, D(3));
    expect(res.status).toBe(409);
    expect(JSON.stringify(res.body)).toContain(D(9));
  });

  it("a Bayana dated before the new joining date does not block it", async () => {
    const w = await makeLabour("BIGARI", { joiningDate: D(30) });
    expect((await asOwner("post", "/api/payments", { recipientId: w.id, type: "BOOKING_ADVANCE", amount: 500, date: D(25) })).status).toBe(201);
    expect((await patchJoin(w, D(5))).status).toBe(200);
  });

  it("a soft-deleted entry does not block", async () => {
    const m = await makeLabour("MAAPVALI", { joiningDate: D(30) });
    await asOwner("put", `/api/maap-entries/day/${D(12)}`, { rows: [{ labourId: m.id, maaps: 4 }], reason: "Late entry" });
    for (const r of db.maap.values()) r.isDeleted = true;
    expect((await patchJoin(m, D(5))).status).toBe(200);
  });
});
