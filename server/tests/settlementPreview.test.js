// FAKE-DATABASE tests for the season-closing PREVIEW (S1). No MongoDB, no network. The preview is read-only.
import { readFileSync } from "node:fs";
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
const changeRate = (w, newRate, effectiveFrom) => asOwner("post", `/api/labours/${w.id}/rates`, { newRate, effectiveFrom, reason: "Revised rate" });
const pay = async (w, o = {}) => {
  const res = await asOwner("post", "/api/payments", { recipientId: w.id, type: "SALARY_PAYMENT", amount: 100, date: today, ...o });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.data;
};

const salary = async (q = "") => (await asOwner("get", `/api/salary${q}`)).body;
const rowOf = (body, w) => body.data.find((r) => r.id === w.id);
const statement = async (w, q = "") => (await asOwner("get", `/api/salary/${w.id}${q}`)).body.data;
const preview = async (seasonId, q = "") => asOwner("get", `/api/seasons/${seasonId}/settlement-preview${q}`);
const itemOf = (body, w) => body.data.items.find((i) => i.labourId === w.id);
const everything = () => JSON.stringify([[...db.attendance.values()], [...db.maap.values()], [...db.production.values()], [...db.seasons.values()], [...db.labours.values()], db.rates, [...db.payments.values()]]);
const dropRates = (w) => {
  for (let i = db.rates.length - 1; i >= 0; i -= 1) if (db.rates[i].labourId === w.id) db.rates.splice(i, 1);
};
const makeSeason = async (name, startDate, endDate) => {
  const res = await asOwner("post", "/api/seasons", { name, startDate, ...(endDate ? { endDate } : {}) });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.data;
};

/** The KNOWN TEST DATA of salary.test.js, with the season start chosen by the test (production before the season start cannot be saved, so it is left out then). */
const fixture = async (seasonStart) => {
  const season = await makeSeason("Season 2026-27", seasonStart);
  const [bigari, maapvali, patlavale] = [await makeLabour("BIGARI"), await makeLabour("MAAPVALI"), await makeLabour("PATLAVALE")];
  for (const [w, rate, from] of [[bigari, 700, D(3)], [maapvali, 300, D(3)], [patlavale, 800, D(1)]]) expect((await changeRate(w, rate, from)).status).toBe(201);
  for (const [d, status] of [[10, "PRESENT"], [8, "HALF_DAY"], [5, "PRESENT"], [2, "PRESENT"], [1, "HALF_DAY"]]) {
    expect((await asOwner("put", `/api/attendance/${D(d)}`, { entries: [{ labourId: bigari.id, status }], reason: "Late entry" })).status).toBe(200);
  }
  for (const [d, maaps] of [[9, 10], [4, 6], [1, 4]]) expect((await asOwner("put", `/api/maap-entries/day/${D(d)}`, { rows: [{ labourId: maapvali.id, maaps }], reason: "Late entry" })).status).toBe(200);
  for (const [d, maaps] of [[7, 4], [2, 5], [0, 3]].filter(([d]) => D(d) >= seasonStart)) expect((await asOwner("put", `/api/production-entries/day/${D(d)}`, { rows: [{ teamId: patlavale.id, maaps }], reason: "Late entry" })).status).toBe(200);
  await pay(bigari, { type: "BOOKING_ADVANCE", amount: 1000, date: D(30) });
  await pay(bigari, { amount: 800, date: D(6) });
  await pay(bigari, { amount: 500, date: D(0) });
  await pay(maapvali, { amount: 200, date: D(2) });
  await pay(patlavale, { type: "BOOKING_ADVANCE", amount: 500, date: D(3) });
  return { season, bigari, maapvali, patlavale };
};

beforeEach(() => {
  today = todayBusinessDate();
  db.reset();
  users.list.length = 0;
  mobileSeq = 0;
  owner = addUser("OWNER");
  manager = addUser("MANAGER", "Helper");
  app = createApp();
});
afterEach(() => vi.useRealTimers());

describe("access and input", () => {
  it("needs an Owner login, rejects a bad id and an unknown season, and has no write route", async () => {
    const { season } = await fixture(D(90));
    expect((await send("get", `/api/seasons/${season.id}/settlement-preview`, null)).status).toBe(401);
    expect((await send("get", `/api/seasons/${season.id}/settlement-preview`, manager.cookie)).status).toBe(403);
    expect((await preview("not-an-id")).status).toBe(400);
    expect((await preview("0123456789abcdef01234567")).status).toBe(404);
    expect((await preview(season.id, "?endDate=2026-13-40")).status).toBe(400);
    expect((await preview(season.id, "?bogus=1")).status).toBe(400);
    for (const method of ["post", "put", "patch", "delete"]) expect((await asOwner(method, `/api/seasons/${season.id}/settlement-preview`, {})).status, method).toBe(404);
  });
  it("an end date before the season start is refused", async () => {
    const { season } = await fixture(D(90));
    expect((await preview(season.id, `?endDate=${D(91)}`)).status).toBe(400);
  });
});

describe("each labour type keeps its own rules (reconciled with the known data)", () => {
  it("Bigari 2,675 earned / Maapvali 1,300 / Patlavale 2,062.50, with their payments, balances and resolutions", async () => {
    const { season, bigari, maapvali, patlavale } = await fixture(D(90));
    const body = (await preview(season.id)).body;
    expect(body.data.readyToClose).toBe(true);
    expect(body.data.proposedEndDate).toBe(today);
    expect(itemOf(body, bigari)).toMatchObject({ opening: 0, earned: 2675, bayana: 1000, salaryPayments: 1300, otherPayments: 0, received: 2300, closing: 375, payable: 375, recoverable: 0, status: "PAYABLE", resolution: { kind: "SETTLE_BY_PAYMENT", amount: 375 } });
    expect(itemOf(body, bigari).work).toMatchObject({ presentDays: 3, halfDays: 2, workingUnits: 4 });
    expect(itemOf(body, maapvali)).toMatchObject({ opening: 0, earned: 1300, received: 200, closing: 1100, payable: 1100, status: "PAYABLE" });
    expect(itemOf(body, maapvali).work).toMatchObject({ maaps: 20, workDays: 3 });
    expect(itemOf(body, patlavale)).toMatchObject({ opening: 0, earned: 2062.5, bayana: 500, received: 500, closing: 1562.5, payable: 1562.5, status: "PAYABLE" });
    expect(itemOf(body, patlavale).work).toMatchObject({ maaps: 12, payableBricks: 3000, physicalBricks: 3300 });
  });
  it("matches the Salary page and statement for the same window, worker by worker (the authoritative calculations)", async () => {
    const { season, bigari, maapvali, patlavale } = await fixture(D(4));
    const body = (await preview(season.id)).body;
    for (const w of [bigari, maapvali, patlavale]) {
      const st = await statement(w, `?from=${D(4)}&to=${today}`);
      const item = itemOf(body, w);
      expect(item.opening, w.labourType).toBe(st.opening);
      expect(item.earned).toBe(st.period.earned);
      expect(item.received).toBe(st.period.received);
      expect(item.closing).toBe(st.closing);
      expect(item.workLines + item.paymentLines).toBe(st.lines.length);
    }
    const sal = await salary(`?from=${D(4)}&to=${today}`);
    for (const w of [bigari, maapvali, patlavale]) expect(itemOf(body, w).closing).toBe(rowOf(sal, w).closing);
  });
  it("carries the balance from before the season start as the opening balance", async () => {
    const { season, bigari } = await fixture(D(4));
    const item = itemOf((await preview(season.id)).body, bigari);
    // before d4: d10 650 + d8 325 + d5 650 = 1,625 earned; Bayana 1,000 + salary 800 received => opening -175
    expect(item).toMatchObject({ opening: -175, earned: 1050, received: 500, closing: 375, status: "PAYABLE" });
  });
  it("totals are exact sums of the workers, by type and overall", async () => {
    const { season } = await fixture(D(90));
    const { summary } = (await preview(season.id)).body.data;
    expect(summary).toMatchObject({ workers: 3, payableWorkers: 3, recoverableWorkers: 0, zeroWorkers: 0, earned: 6037.5, received: 3000, payable: 3037.5, recoverable: 0 });
    expect(summary.byType.map((t) => [t.type, t.workers, t.earned, t.payable])).toEqual([["BIGARI", 1, 2675, 375], ["MAAPVALI", 1, 1300, 1100], ["PATLAVALE", 1, 2062.5, 1562.5]]);
  });
});

describe("edge cases", () => {
  it("a worker with no earnings and no payments is shown as ZERO with nothing to settle", async () => {
    const { season } = await fixture(D(90));
    const idle = await makeLabour("BIGARI");
    const item = itemOf((await preview(season.id)).body, idle);
    expect(item).toMatchObject({ earned: 0, received: 0, closing: 0, payable: 0, recoverable: 0, status: "ZERO", resolution: { kind: "NONE", amount: 0 } });
  });
  it("a worker paid more than earned is RECOVERABLE: carried forward as an opening advance, never written off or treated as settled", async () => {
    const { season } = await fixture(D(90));
    const w = await makeLabour("BIGARI");
    await pay(w, { type: "BOOKING_ADVANCE", amount: 400, date: D(20) });
    const body = (await preview(season.id)).body;
    const item = itemOf(body, w);
    expect(item).toMatchObject({ earned: 0, received: 400, closing: -400, payable: 0, recoverable: 400, status: "RECOVERABLE" });
    expect(item.resolution).toMatchObject({ kind: "CARRY_FORWARD_AS_OPENING_ADVANCE", amount: 400, requiresExplicitDecision: true });
    expect(body.data.warnings.map((x) => x.code)).toContain("NEGATIVE_BALANCES");
    expect(body.data.summary).toMatchObject({ recoverableWorkers: 1, recoverable: 400 });
    expect(body.data.summary.payable).toBe(3037.5); // a negative balance never offsets someone else's payable amount
  });
  it("partial payments already made are counted; a fully paid worker shows zero remaining", async () => {
    const { season } = await fixture(D(90));
    const w = await makeLabour("MAAPVALI");
    expect((await asOwner("put", `/api/maap-entries/day/${D(3)}`, { rows: [{ labourId: w.id, maaps: 8 }], reason: "Late entry" })).status).toBe(200);
    await pay(w, { amount: 200, date: D(2) });
    expect(itemOf((await preview(season.id)).body, w)).toMatchObject({ earned: 500, received: 200, closing: 300, status: "PAYABLE" });
    await pay(w, { amount: 300, date: D(1) });
    expect(itemOf((await preview(season.id)).body, w)).toMatchObject({ closing: 0, payable: 0, status: "ZERO" });
  });
  it("inactive workers: kept when they have a balance or activity, left out (and counted) when they have nothing", async () => {
    const { season, maapvali } = await fixture(D(90));
    const idle = await makeLabour("BIGARI");
    db.labours.get(maapvali.id).status = "INACTIVE";
    db.labours.get(idle.id).status = "INACTIVE";
    const body = (await preview(season.id)).body;
    expect(itemOf(body, maapvali)).toMatchObject({ labourStatus: "INACTIVE", closing: 1100, status: "PAYABLE" });
    expect(itemOf(body, idle)).toBeUndefined();
    expect(body.data.notIncluded).toBe(1);
  });
  it("a worker who joined after the season end is not in the statements", async () => {
    const season = await makeSeason("Old season", D(50), D(30));
    const late = await makeLabour("BIGARI", { joiningDate: D(10) });
    const body = (await preview(season.id)).body;
    expect(itemOf(body, late)).toBeUndefined();
  });
  it("records dated after the season end are excluded from the statement and reported as a warning", async () => {
    const season = await makeSeason("Old season", D(90), D(5));
    const w = await makeLabour("BIGARI");
    for (const d of [8, 3]) expect((await asOwner("put", `/api/attendance/${D(d)}`, { entries: [{ labourId: w.id, status: "PRESENT" }], reason: "Late entry" })).status).toBe(200);
    const body = (await preview(season.id)).body;
    expect(itemOf(body, w)).toMatchObject({ earned: 650, afterEnd: { lines: 1, firstDate: D(3) } });
    expect(body.data.proposedEndDate).toBe(D(5));
    expect(body.data.warnings.map((x) => x.code)).toContain("ACTIVITY_AFTER_END");
  });
  it("Bigari days with no rate block the close (earnings would be understated) but are still reported, never invented", async () => {
    const { season } = await fixture(D(90));
    const w = await makeLabour("BIGARI");
    for (const d of [5, 4]) expect((await asOwner("put", `/api/attendance/${D(d)}`, { entries: [{ labourId: w.id, status: "PRESENT" }], reason: "Late entry" })).status).toBe(200);
    dropRates(w);
    const body = (await preview(season.id)).body;
    expect(itemOf(body, w)).toMatchObject({ earned: 0, missingRateDays: 2 });
    expect(body.data.readyToClose).toBe(false);
    expect(body.data.blockers).toEqual([expect.objectContaining({ code: "MISSING_RATE", labourIds: [w.id] })]);
  });
});

describe("season dates", () => {
  it("the next season must start the day after this one ends", async () => {
    const a = await makeSeason("Season A", D(90), D(31));
    await makeSeason("Season B", D(20));
    const bad = (await preview(a.id)).body.data;
    expect(bad.nextSeasonMustStartOn).toBe(D(30));
    expect(bad.readyToClose).toBe(false);
    expect(bad.blockers.map((b) => b.code)).toContain("NEXT_SEASON_START");
  });
  it("is ready when the next season starts exactly the day after", async () => {
    const a = await makeSeason("Season A", D(90), D(31));
    await makeSeason("Season B", D(30));
    const ok = (await preview(a.id)).body.data;
    expect(ok.blockers).toEqual([]);
    expect(ok.readyToClose).toBe(true);
    expect(ok.ledgerDateForSettlementPayments).toBe(D(31));
  });
  it("a proposed end date can be tried without saving it; a future end date blocks", async () => {
    const a = await makeSeason("Season A", D(90));
    const tried = (await preview(a.id, `?endDate=${D(10)}`)).body.data;
    expect(tried.proposedEndDate).toBe(D(10));
    expect(tried.season.endDate).toBeNull();
    const future = (await preview(a.id, `?endDate=${addDays(today, 3)}`)).body.data;
    expect(future.readyToClose).toBe(false);
    expect(future.blockers.map((b) => b.code)).toContain("END_IN_FUTURE");
  });
  it("an already-CLOSED season is previewed with a warning; nothing about it changes", async () => {
    const a = await makeSeason("Season A", D(90), D(31));
    db.seasons.get(a.id).status = "CLOSED"; // closing now goes through the settlement close (S2); set the state directly here
    const body = (await preview(a.id)).body.data;
    expect(body.season.status).toBe("CLOSED");
    expect(body.warnings.map((x) => x.code)).toContain("ALREADY_CLOSED");
  });
});

describe("read only: nothing is written, whatever the preview finds", () => {
  it("leaves attendance, Maapvali, production, payments, rates, labours and seasons byte-identical", async () => {
    const { season } = await fixture(D(90));
    await makeLabour("BIGARI");
    const before = everything();
    for (const q of ["", `?endDate=${D(10)}`, `?endDate=${addDays(today, 2)}`]) expect((await preview(season.id, q)).status).toBe(200);
    expect(everything()).toBe(before);
  });
  it("the service source contains no write call and imports only read models", () => {
    const source = readFileSync(new URL("../services/settlementPreview.service.js", import.meta.url), "utf8");
    const code = source.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
    expect(code).not.toMatch(/\.(create|insertMany|insertOne|updateOne|updateMany|findOneAndUpdate|findByIdAndUpdate|deleteOne|deleteMany|bulkWrite|save|replaceOne|runInTransaction)\(/);
    expect(code.match(/^import .* from "\.\.\/models\/[A-Za-z]+\.js"/gm)).toEqual(['import Labour from "../models/Labour.js"']);
  });
  it("the shared calculations are the existing ones (no second copy of the earning rules)", () => {
    const source = readFileSync(new URL("../services/settlementPreview.service.js", import.meta.url), "utf8");
    expect(source).toMatch(/import \{[^}]*buildLedger[^}]*summarizeAccount[^}]*\} from "\.\/salaryCalculations\.js"/);
    expect(source).toMatch(/import \{ loadSources \} from "\.\/salary\.service\.js"/);
    expect(source).not.toMatch(/earnedPaiseFor|ratePaiseAt|earningsPaise|ATTENDANCE_UNITS/);
  });
});
