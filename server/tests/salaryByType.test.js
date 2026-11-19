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

// Phase 1C Stage 3 / C1: summary.byType carries the same incomplete / missingRateAccounts information as summary.total.
// FAKE-DATABASE tests only (no real MongoDB / Atlas).
const summaryOf = async () => (await asOwner("get", `/api/salary?from=${D(30)}&to=${todayBusinessDate()}`)).body.meta.summary;
const typeOf = (summary, type) => summary.byType.find((t) => t.type === type);
const maapDay = async (w, maaps = 8) => expect((await asOwner("put", `/api/maap-entries/day/${D(3)}`, { rows: [{ labourId: w.id, maaps }], reason: "Late entry" })).status).toBe(200);
const patlavaleDay = async (t, maaps = 8) => {
  expect((await asOwner("post", "/api/seasons", { name: "Season 2026-27", startDate: D(90) })).status).toBe(201);
  expect((await asOwner("put", `/api/production-entries/day/${D(3)}`, { rows: [{ teamId: t.id, maaps }], reason: "Late entry" })).status).toBe(200);
};
const ORIGINAL_KEYS = ["accounts", "earned", "outstanding", "overpaid", "overpaidCount", "paid", "received", "seasonEarned", "seasonReceived", "type"];
const strip = ({ incomplete, missingRateAccounts, ...rest }) => rest;

describe("characterization: summary.byType as it is today (values and structure; pinned BEFORE the C1 change)", () => {
  it("has one entry per labour type, in the fixed order, with the original fields and values", async () => {
    const b = await makeLabour("BIGARI");
    await attend(b, 5);
    await attend(b, 4);
    const m = await makeLabour("MAAPVALI");
    await maapDay(m, 8);
    const t = await makeLabour("PATLAVALE");
    await patlavaleDay(t, 8);
    const s = await summaryOf();
    expect(s.byType.map((x) => x.type)).toEqual(["BIGARI", "MAAPVALI", "PATLAVALE"]);
    for (const entry of s.byType) expect(Object.keys(strip(entry)).sort()).toEqual(ORIGINAL_KEYS);
    expect(strip(typeOf(s, "BIGARI"))).toMatchObject({ accounts: 1, earned: 1300, seasonEarned: 1300, received: 0, paid: 0, outstanding: 1300, overpaid: 0, overpaidCount: 0 });
    expect(strip(typeOf(s, "MAAPVALI"))).toMatchObject({ accounts: 1, earned: 500, outstanding: 500 });
    expect(strip(typeOf(s, "PATLAVALE"))).toMatchObject({ accounts: 1, outstanding: expect.any(Number) });
    expect(s.total).toMatchObject({ earned: expect.any(Number), outstanding: expect.any(Number), incomplete: false, missingRateAccounts: 0 });
  });

  it("a rate-less Bigari still counts as 0 earned in byType (nothing is invented)", async () => {
    const b = await makeLabour("BIGARI");
    await attend(b, 5);
    dropRates(b);
    expect(strip(typeOf(await summaryOf(), "BIGARI"))).toMatchObject({ accounts: 1, earned: 0, outstanding: 0 });
  });
});

describe("C1: summary.byType reports incomplete / missingRateAccounts exactly as summary.total does", () => {
  it("every byType entry has both fields, with the right types", async () => {
    await makeLabour("BIGARI");
    const s = await summaryOf();
    for (const entry of s.byType) {
      expect(typeof entry.incomplete).toBe("boolean");
      expect(Number.isInteger(entry.missingRateAccounts)).toBe(true);
    }
  });

  it("1. Bigari with one rate-less worker among two: flagged, counting only that worker", async () => {
    const ok = await makeLabour("BIGARI");
    await attend(ok, 5);
    const bad = await makeLabour("BIGARI");
    await attend(bad, 5);
    dropRates(bad);
    const big = typeOf(await summaryOf(), "BIGARI");
    expect(big).toMatchObject({ incomplete: true, missingRateAccounts: 1, accounts: 2, earned: 650 }); // the value is unchanged: only the rated worker earned
  });

  it("a rate-less worker with no attendance is NOT flagged (nothing was left unpriced)", async () => {
    const w = await makeLabour("BIGARI");
    dropRates(w);
    expect(typeOf(await summaryOf(), "BIGARI")).toMatchObject({ incomplete: false, missingRateAccounts: 0 });
  });

  it("2. Bigari with no rate-less worker: clean", async () => {
    const a = await makeLabour("BIGARI");
    await attend(a, 5);
    const b = await makeLabour("BIGARI");
    await attend(b, 4);
    expect(typeOf(await summaryOf(), "BIGARI")).toMatchObject({ incomplete: false, missingRateAccounts: 0, earned: 1300 });
  });

  it("3. Maapvali: clean, even while a Bigari is flagged", async () => {
    const m = await makeLabour("MAAPVALI");
    await maapDay(m);
    const b = await makeLabour("BIGARI");
    await attend(b, 5);
    dropRates(b);
    const s = await summaryOf();
    expect(typeOf(s, "MAAPVALI")).toMatchObject({ incomplete: false, missingRateAccounts: 0, earned: 500 });
    expect(typeOf(s, "BIGARI").incomplete).toBe(true);
  });

  it("4. Patlavale: clean, even while a Bigari is flagged", async () => {
    const t = await makeLabour("PATLAVALE");
    await patlavaleDay(t);
    const b = await makeLabour("BIGARI");
    await attend(b, 5);
    dropRates(b);
    const s = await summaryOf();
    expect(typeOf(s, "PATLAVALE")).toMatchObject({ incomplete: false, missingRateAccounts: 0 });
    expect(typeOf(s, "BIGARI")).toMatchObject({ incomplete: true, missingRateAccounts: 1 });
  });

  it("5. summary.total agrees with the type entries and with the per-worker rows", async () => {
    const ok = await makeLabour("BIGARI");
    await attend(ok, 5);
    const bad1 = await makeLabour("BIGARI");
    await attend(bad1, 5);
    dropRates(bad1);
    const bad2 = await makeLabour("BIGARI");
    await attend(bad2, 4);
    dropRates(bad2);
    const m = await makeLabour("MAAPVALI");
    await maapDay(m);
    const body = (await asOwner("get", `/api/salary?from=${D(30)}&to=${todayBusinessDate()}`)).body;
    const s = body.meta.summary;
    expect(s.total.missingRateAccounts).toBe(s.byType.reduce((t, x) => t + x.missingRateAccounts, 0));
    expect(s.total.incomplete).toBe(s.byType.some((x) => x.incomplete));
    expect(s.total.missingRateAccounts).toBe(body.data.filter((r) => r.incomplete).length);
    expect(s.total).toMatchObject({ incomplete: true, missingRateAccounts: 2 });
    for (const t of s.byType) expect(t.missingRateAccounts).toBe(body.data.filter((r) => r.labourType === t.type && r.incomplete).length);
  });

  it("the C1 fields change no value and no other field (byType and total numbers equal the characterization)", async () => {
    const a = await makeLabour("BIGARI");
    await attend(a, 5);
    const b = await makeLabour("BIGARI");
    await attend(b, 4);
    dropRates(b);
    const s = await summaryOf();
    expect(strip(typeOf(s, "BIGARI"))).toEqual({ type: "BIGARI", accounts: 2, earned: 650, received: 0, paid: 0, seasonEarned: 650, seasonReceived: 0, outstanding: 650, overpaid: 0, overpaidCount: 0 });
    expect(Object.keys(typeOf(s, "BIGARI")).sort()).toEqual([...ORIGINAL_KEYS, "incomplete", "missingRateAccounts"].sort());
  });

  it("a request with no workers at all gives clean entries", async () => {
    const s = await summaryOf();
    for (const t of s.byType) expect(t).toMatchObject({ incomplete: false, missingRateAccounts: 0, accounts: 0 });
  });

  it("is read-only: nothing stored changes", async () => {
    const w = await makeLabour("BIGARI");
    await attend(w, 5);
    dropRates(w);
    const before = snapshot();
    await summaryOf();
    expect(snapshot()).toBe(before);
  });
});
