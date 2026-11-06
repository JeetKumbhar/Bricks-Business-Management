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
const RANGE = () => `?from=${D(6)}&to=${today}`;

/**
 * KNOWN TEST DATA (today = D0; "dN" = N days ago). Worked out by hand, then checked by the tests below.
 *  Bigari  rate 650, raised to 700 from d3.  d10 P 650 | d8 H 325 | d5 P 650 | d2 P 700 | d1 H 350   => earned 2,675.00
 *          payments: Bayana 1,000 (d30), salary 800 (d6), salary 500 (d0)                            => received 2,300.00, balance 375.00
 *  Maapvali 250 per 4 maaps, raised to 300 from d3.  d9 10 maaps 625 | d4 6 maaps 375 | d1 4 maaps 300 => earned 1,300.00
 *          payments: salary 200 (d2)                                                                  => balance 1,100.00
 *  Patlavale 650 per 4 maaps, raised to 800 from d1.  d7 4 maaps 650 | d2 5 maaps 812.50 | d0 3 maaps 600 => earned 2,062.50
 *          payments: Bayana 500 (d3)                                                                  => balance 1,562.50
 * Range = last 7 days (d6 to d0).
 */
const fixture = async () => {
  const season = await asOwner("post", "/api/seasons", { name: "Season 2026-27", startDate: D(90) });
  expect(season.status).toBe(201);
  const [bigari, maapvali, patlavale] = [await makeLabour("BIGARI"), await makeLabour("MAAPVALI"), await makeLabour("PATLAVALE")];
  for (const [w, rate, from] of [[bigari, 700, D(3)], [maapvali, 300, D(3)], [patlavale, 800, D(1)]]) expect((await changeRate(w, rate, from)).status).toBe(201);
  for (const [d, status] of [[10, "PRESENT"], [8, "HALF_DAY"], [5, "PRESENT"], [2, "PRESENT"], [1, "HALF_DAY"]]) {
    expect((await asOwner("put", `/api/attendance/${D(d)}`, { entries: [{ labourId: bigari.id, status }], reason: "Late entry" })).status).toBe(200);
  }
  for (const [d, maaps] of [[9, 10], [4, 6], [1, 4]]) expect((await asOwner("put", `/api/maap-entries/day/${D(d)}`, { rows: [{ labourId: maapvali.id, maaps }], reason: "Late entry" })).status).toBe(200);
  for (const [d, maaps] of [[7, 4], [2, 5], [0, 3]]) expect((await asOwner("put", `/api/production-entries/day/${D(d)}`, { rows: [{ teamId: patlavale.id, maaps }], reason: "Late entry" })).status).toBe(200);
  await pay(bigari, { type: "BOOKING_ADVANCE", amount: 1000, date: D(30) });
  await pay(bigari, { amount: 800, date: D(6) });
  await pay(bigari, { amount: 500, date: D(0) });
  await pay(maapvali, { amount: 200, date: D(2) });
  await pay(patlavale, { type: "BOOKING_ADVANCE", amount: 500, date: D(3) });
  return { bigari, maapvali, patlavale };
};
const workSnapshot = () => JSON.stringify([[...db.attendance.values()], [...db.maap.values()], [...db.production.values()], [...db.seasons.values()], [...db.labours.values()], db.rates]);

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

// ---------------------------------------------------------------------------
describe("access", () => {
  it("needs a login, is readable by any signed-in user, and has no write route", async () => {
    expect((await send("get", "/api/salary", null)).status).toBe(401);
    expect((await send("get", "/api/salary/L-001", null)).status).toBe(401);
    expect((await send("get", "/api/salary", manager.cookie)).status).toBe(200);
    for (const method of ["post", "put", "patch", "delete"]) expect((await send(method, "/api/salary", owner.cookie, {})).status, method).toBe(404);
  });
});

// ---------------------------------------------------------------------------
describe("Bigari: earnings from attendance at the rate in force each day", () => {
  it("reconciles with the known data: period, opening, closing and season to date", async () => {
    const { bigari } = await fixture();
    const row = rowOf(await salary(RANGE()), bigari);
    expect(row.period).toMatchObject({ earned: 1700, received: 1300, bayana: 0, salary: 1300, other: 0, paid: 1300 });
    expect(row.period.work).toEqual({ presentDays: 2, halfDays: 1, absentDays: 0, workingUnits: 2.5 });
    expect(row.opening).toBe(-25); // 975 earned before the range, 1,000 Bayana already paid
    expect(row.closing).toBe(375); // -25 + 1,700 - 1,300
    expect(row.season).toEqual({ earned: 2675, received: 2300, balance: 375 });
  });

  it("prices each day at its own rate: 650 before d3, 700 from d3, and half a day is half the rate", async () => {
    const { bigari } = await fixture();
    const lines = (await statement(bigari)).lines.filter((l) => l.kind === "ATTENDANCE");
    expect(lines.map((l) => [l.date, l.status, l.rate, l.earned])).toEqual([[D(10), "PRESENT", 650, 650], [D(8), "HALF_DAY", 650, 325], [D(5), "PRESENT", 650, 650], [D(2), "PRESENT", 700, 700], [D(1), "HALF_DAY", 700, 350]]);
  });

  it("a later rate change never rewrites earlier days", async () => {
    const { bigari } = await fixture();
    const before = (await statement(bigari)).season.earned;
    expect((await changeRate(bigari, 900, today)).status).toBe(201);
    expect((await statement(bigari)).season.earned).toBe(before);
  });

  it("an absent day earns nothing but is counted", async () => {
    const w = await makeLabour("BIGARI");
    await asOwner("put", `/api/attendance/${D(1)}`, { entries: [{ labourId: w.id, status: "ABSENT" }], reason: "Late entry" });
    const row = rowOf(await salary(`?from=${D(2)}&to=${today}`), w);
    expect(row.period).toMatchObject({ earned: 0 });
    expect(row.period.work).toMatchObject({ absentDays: 1, workingUnits: 0 });
  });
});

// ---------------------------------------------------------------------------
describe("Maapvali: earnings proportional to maaps, each entry at its own rate", () => {
  it("reconciles with the known data", async () => {
    const { maapvali } = await fixture();
    const row = rowOf(await salary(RANGE()), maapvali);
    expect(row.period).toMatchObject({ earned: 675, received: 200, salary: 200 });
    expect(row.period.work).toEqual({ maaps: 10, workDays: 2 });
    expect(row.opening).toBe(625);
    expect(row.closing).toBe(1100);
    expect(row.season).toEqual({ earned: 1300, received: 200, balance: 1100 });
  });

  it("each entry keeps the rate it was recorded at (250 per 4 before d3, 300 after)", async () => {
    const { maapvali } = await fixture();
    const lines = (await statement(maapvali)).lines.filter((l) => l.kind === "MAAP");
    expect(lines.map((l) => [l.date, l.maaps, l.ratePerFourMaaps, l.earned])).toEqual([[D(9), 10, 250, 625], [D(4), 6, 250, 375], [D(1), 4, 300, 300]]);
  });

  it("a later rate change does not change recorded earnings", async () => {
    const { maapvali } = await fixture();
    await changeRate(maapvali, 500, today);
    expect((await statement(maapvali)).season.earned).toBe(1300);
  });

  it("every maap is paid: 5 maaps at 250 per 4 is 312.50, not 250", async () => {
    const w = await makeLabour("MAAPVALI");
    await asOwner("put", `/api/maap-entries/day/${today}`, { rows: [{ labourId: w.id, maaps: 5 }] });
    expect(rowOf(await salary(RANGE()), w).period).toMatchObject({ earned: 312.5 });
  });
});

// ---------------------------------------------------------------------------
describe("Patlavale: earnings from production, each entry at its own rate", () => {
  it("reconciles with the known data, with maaps, physical and payable bricks kept separate", async () => {
    const { patlavale } = await fixture();
    const row = rowOf(await salary(RANGE()), patlavale);
    expect(row.period).toMatchObject({ earned: 1412.5, received: 500, bayana: 500, salary: 0, paid: 500 });
    expect(row.period.work).toEqual({ maaps: 8, physicalBricks: 2200, payableBricks: 2000, entries: 2 });
    expect(row.opening).toBe(650);
    expect(row.closing).toBe(1562.5);
    expect(row.season).toEqual({ earned: 2062.5, received: 500, balance: 1562.5 });
  });

  it("each entry keeps its own rate (650 per 4 maaps until d1, 800 after) and 250 payable bricks per maap", async () => {
    const { patlavale } = await fixture();
    const lines = (await statement(patlavale)).lines.filter((l) => l.kind === "PRODUCTION");
    expect(lines.map((l) => [l.date, l.maaps, l.payableBricks, l.ratePer1000PayableBricks, l.earned])).toEqual([[D(7), 4, 1000, 650, 650], [D(2), 5, 1250, 650, 812.5], [D(0), 3, 750, 800, 600]]);
  });

  it("is one account for the whole team, never split per member", async () => {
    const { patlavale } = await fixture();
    const body = await salary(RANGE());
    expect(body.data.filter((r) => r.labourType === "PATLAVALE")).toHaveLength(1);
    expect(rowOf(body, patlavale)).not.toHaveProperty("members");
  });
});

// ---------------------------------------------------------------------------
describe("advances (Bayana) and partial payments", () => {
  it("Bayana is counted once as received, not subtracted again", async () => {
    const { bigari } = await fixture();
    const s = (await statement(bigari)).season;
    expect(s.received).toBe(2300); // 1,000 Bayana + 800 + 500, not 1,000 twice
    expect(s.balance).toBe(2675 - 2300);
  });

  it("a Bayana before any work is an advance: the balance goes negative, then work brings it back", async () => {
    const w = await makeLabour("MAAPVALI");
    await pay(w, { type: "BOOKING_ADVANCE", amount: 1000, date: D(5) });
    expect(rowOf(await salary(), w).season).toEqual({ earned: 0, received: 1000, balance: -1000 });
    await asOwner("put", `/api/maap-entries/day/${today}`, { rows: [{ labourId: w.id, maaps: 16 }] }); // 1,000 at 250 per 4
    expect(rowOf(await salary(), w).season).toEqual({ earned: 1000, received: 1000, balance: 0 });
  });

  it("partial payments reduce the outstanding balance step by step, to zero and then past it", async () => {
    const { maapvali } = await fixture(); // balance 1,100
    const balances = [];
    for (const amount of [400, 300, 399, 101]) {
      await pay(maapvali, { amount, date: D(0) });
      balances.push(rowOf(await salary(), maapvali).season.balance);
    }
    expect(balances).toEqual([700, 400, 1, -100]);
    const summary = (await salary()).meta.summary.byType.find((t) => t.type === "MAAPVALI");
    expect(summary).toMatchObject({ outstanding: 0, overpaid: 100, overpaidCount: 1 });
  });

  it("other payments count as received for now (the open policy), and are shown separately", async () => {
    const w = await makeLabour("BIGARI");
    await asOwner("put", `/api/attendance/${D(1)}`, { entries: [{ labourId: w.id, status: "PRESENT" }], reason: "Late entry" });
    await pay(w, { type: "OTHER", amount: 100, note: "Tea money", date: D(0) });
    const row = rowOf(await salary(RANGE()), w);
    expect(row.period).toMatchObject({ earned: 650, other: 100, received: 100, paid: 100 });
    expect(row.season.balance).toBe(550);
  });

  it("the policy decides what counts: when OTHER does not count, it is paid but not received", () => {
    const labour = { labourType: "BIGARI" };
    const payments = [
      { _id: "p1", date: "2026-11-01", type: "BOOKING_ADVANCE", amountPaise: 100000, method: "CASH" },
      { _id: "p2", date: "2026-11-01", type: "OTHER", amountPaise: 5000, method: "CASH" },
      { _id: "p3", date: "2026-11-02", type: "SALARY_PAYMENT", amountPaise: 2500, method: "CASH" },
    ];
    const lines = buildLedger(labour, { payments }, { bayanaCountsAsReceived: true, otherCountsAsReceived: false });
    const a = summarizeAccount("BIGARI", lines, "0000-01-01", "2026-11-30");
    expect(a.period).toMatchObject({ paidPaise: 107500, receivedPaise: 102500, otherPaise: 5000 });
    expect(a.toDate.balancePaise).toBe(-102500);
  });
});

// ---------------------------------------------------------------------------
describe("payments never change earned amounts", () => {
  it("creating, correcting and voiding payments leave every earned figure, work record and production total alone", async () => {
    const { bigari, maapvali, patlavale } = await fixture();
    const earned = async () => (await salary(RANGE())).data.map((r) => [r.id, r.period.earned, r.period.work, r.season.earned]);
    const before = [await earned(), workSnapshot()];
    for (const w of [bigari, maapvali, patlavale]) {
      const p = await pay(w, { amount: 777, date: D(1) });
      await asOwner("patch", `/api/payments/${p.id}`, { amount: 999, reason: "Typed the wrong amount" });
      await pay(w, { type: "BOOKING_ADVANCE", amount: 123, date: D(2) });
      await asOwner("delete", `/api/payments/${p.id}`, { reason: "Wrong person" });
    }
    expect([await earned(), workSnapshot()]).toEqual(before);
  });

  it("payments move received and balance by exactly their amount", async () => {
    const { patlavale } = await fixture();
    const before = rowOf(await salary(), patlavale).season;
    await pay(patlavale, { amount: 250.25, date: D(0) });
    const after = rowOf(await salary(), patlavale).season;
    expect([after.earned, after.received, after.balance]).toEqual([before.earned, before.received + 250.25, before.balance - 250.25]);
  });

  it("voided payments are not counted, corrected ones use the corrected amount", async () => {
    const { maapvali } = await fixture();
    const p = await pay(maapvali, { amount: 300, date: D(0) });
    expect(rowOf(await salary(), maapvali).season.balance).toBe(800);
    await asOwner("patch", `/api/payments/${p.id}`, { amount: 500, reason: "Typed the wrong amount" });
    expect(rowOf(await salary(), maapvali).season.balance).toBe(600);
    await asOwner("delete", `/api/payments/${p.id}`, { reason: "Wrong person" });
    expect(rowOf(await salary(), maapvali).season.balance).toBe(1100);
    expect((await statement(maapvali)).lines.filter((l) => l.kind === "PAYMENT")).toHaveLength(1); // only the original 200
  });
});

// ---------------------------------------------------------------------------
describe("summary by type and the outstanding totals", () => {
  it("matches the known data: totals by type and overall", async () => {
    await fixture();
    const { summary } = (await salary(RANGE())).meta;
    const by = Object.fromEntries(summary.byType.map((t) => [t.type, t]));
    expect(by.BIGARI).toMatchObject({ accounts: 1, earned: 1700, received: 1300, paid: 1300, seasonEarned: 2675, seasonReceived: 2300, outstanding: 375, overpaid: 0 });
    expect(by.MAAPVALI).toMatchObject({ accounts: 1, earned: 675, received: 200, seasonEarned: 1300, outstanding: 1100 });
    expect(by.PATLAVALE).toMatchObject({ accounts: 1, earned: 1412.5, received: 500, seasonEarned: 2062.5, outstanding: 1562.5 });
    expect(summary.total).toEqual({ earned: 3787.5, received: 2000, paid: 2000, outstanding: 3037.5, overpaid: 0, overpaidCount: 0 });
  });

  it("the totals are the sum of the rows", async () => {
    await fixture();
    const body = await salary(RANGE());
    const sum = (pick) => Math.round(body.data.reduce((t, r) => t + pick(r) * 100, 0)) / 100;
    expect(body.meta.summary.total.earned).toBe(sum((r) => r.period.earned));
    expect(body.meta.summary.total.received).toBe(sum((r) => r.period.received));
    expect(body.meta.summary.total.outstanding).toBe(sum((r) => Math.max(r.season.balance, 0)));
  });

  it("season to date and outstanding do not depend on the range and are never reset by a payment", async () => {
    const { bigari } = await fixture();
    const ranges = ["", RANGE(), `?from=${D(2)}&to=${D(1)}`, `?from=${D(100)}&to=${D(50)}`];
    const seen = [];
    for (const q of ranges) {
      const body = await salary(q);
      seen.push([rowOf(body, bigari).season, body.meta.summary.total.outstanding]);
    }
    for (const s of seen) expect(s).toEqual(seen[0]);
    await pay(bigari, { amount: 100, date: D(0) });
    expect((await salary(RANGE())).meta.summary.total.outstanding).toBe(3037.5 - 100);
  });

  it("with no range the period is everything: it equals season to date", async () => {
    const { bigari } = await fixture();
    const row = rowOf(await salary(), bigari);
    expect(row.opening).toBe(0);
    expect(row.period).toMatchObject({ earned: row.season.earned, received: row.season.received });
    expect(row.closing).toBe(row.season.balance);
  });

  it("filters by type and status, and an unknown filter is rejected", async () => {
    await fixture();
    expect((await salary("?labourType=PATLAVALE")).data).toHaveLength(1);
    expect((await salary("?labourType=MAAPVALI&status=ACTIVE")).data).toHaveLength(1);
    expect((await asOwner("get", "/api/salary?labourType=TRUCK")).status).toBe(400);
  });

  it("keeps active workers, anyone with activity or a balance, and hides an idle inactive worker", async () => {
    const [idle, owed, fresh] = [await makeLabour("BIGARI"), await makeLabour("BIGARI"), await makeLabour("BIGARI")];
    await asOwner("put", `/api/attendance/${D(40)}`, { entries: [{ labourId: owed.id, status: "PRESENT" }], reason: "Late entry" });
    for (const w of [idle, owed]) await asOwner("patch", `/api/labours/${w.id}`, { status: "INACTIVE" });
    const ids = (await salary(RANGE())).data.map((r) => r.id);
    expect(ids).toContain(fresh.id); // active, nothing yet
    expect(ids).toContain(owed.id); // inactive but still owed 650, long before the range
    expect(ids).not.toContain(idle.id); // inactive, no work, no money, no balance
  });
});

// ---------------------------------------------------------------------------
describe("traceability: every figure points at its source records", () => {
  it("each line carries the id of a real source record", async () => {
    const { bigari, maapvali, patlavale } = await fixture();
    const stores = { ATTENDANCE: db.attendance, MAAP: db.maap, PRODUCTION: db.production, PAYMENT: db.payments };
    for (const w of [bigari, maapvali, patlavale]) {
      for (const line of (await statement(w)).lines) {
        const ids = [...stores[line.kind].values()].map((r) => String(r._id));
        expect(ids, `${w.id} ${line.kind}`).toContain(line.sourceId);
      }
    }
  });

  it("the lines add up to the period totals, and the running balance ends at the closing balance", async () => {
    const { bigari, maapvali, patlavale } = await fixture();
    for (const w of [bigari, maapvali, patlavale]) {
      const s = await statement(w, RANGE());
      const total = (key) => Math.round(s.lines.reduce((t, l) => t + l[key] * 100, 0)) / 100;
      expect(total("earned"), w.id).toBe(s.period.earned);
      expect(total("received"), w.id).toBe(s.period.received);
      expect(Math.round((s.opening + s.period.earned - s.period.received) * 100) / 100).toBe(s.closing);
      expect(s.lines.at(-1).balance).toBe(s.closing);
      expect(s.lines.map((l) => l.date)).toEqual([...s.lines.map((l) => l.date)].sort());
    }
  });

  it("the first line's running balance starts from the opening balance", async () => {
    const { bigari } = await fixture();
    const s = await statement(bigari, RANGE());
    const first = s.lines[0];
    expect(first.balance).toBe(Math.round((s.opening + first.earned - first.received) * 100) / 100);
  });

  it("the statement agrees with the summary row and with the Phase 8 balance for every labour", async () => {
    const { bigari, maapvali, patlavale } = await fixture();
    const body = await salary(RANGE());
    for (const w of [bigari, maapvali, patlavale]) {
      const s = await statement(w, RANGE());
      const row = rowOf(body, w);
      expect([s.opening, s.period, s.closing, s.season]).toEqual([row.opening, row.period, row.closing, row.season]);
      const balance = (await asOwner("get", `/api/labours/${w.id}/balance`)).body.data;
      expect([row.season.earned, row.season.received, row.season.balance]).toEqual([balance.earned, balance.totalReceived, balance.balance]);
    }
  });

  it("payment lines say whether they counted as received, and show their type", async () => {
    const { bigari } = await fixture();
    const pays = (await statement(bigari)).lines.filter((l) => l.kind === "PAYMENT");
    expect(pays.map((l) => [l.paymentType, l.amount, l.countedAsReceived])).toEqual([["BOOKING_ADVANCE", 1000, true], ["SALARY_PAYMENT", 800, true], ["SALARY_PAYMENT", 500, true]]);
  });

  it("on one day, work comes before money", async () => {
    const w = await makeLabour("MAAPVALI");
    await pay(w, { amount: 100, date: today });
    await asOwner("put", `/api/maap-entries/day/${today}`, { rows: [{ labourId: w.id, maaps: 4 }] });
    expect((await statement(w)).lines.map((l) => l.kind)).toEqual(["MAAP", "PAYMENT"]);
  });

  it("a Bigari day with no record counts as nothing: no line, no earnings", async () => {
    const w = await makeLabour("BIGARI");
    const s = await statement(w, RANGE());
    expect(s.lines).toEqual([]);
    expect(s.period.earned).toBe(0);
  });
});

// ---------------------------------------------------------------------------
describe("validation and errors", () => {
  it("rejects bad dates, a reversed range, unknown parameters and bad ids", async () => {
    const w = await makeLabour("BIGARI");
    for (const url of [`/api/salary?from=${today}&to=${D(3)}`, "/api/salary?from=2026-02-30", "/api/salary?from=yesterday", "/api/salary?x=1", `/api/salary/${w.id}?from=${today}&to=${D(3)}`, `/api/salary/${w.id}?x=1`, "/api/salary/nobody"]) {
      expect((await asOwner("get", url)).status, url).toBe(400);
    }
  });

  it("returns 404 for an unknown labour and works with a future end date", async () => {
    expect((await asOwner("get", "/api/salary/L-404")).status).toBe(404);
    const w = await makeLabour("BIGARI");
    expect((await asOwner("get", `/api/salary/${w.id}?to=${addDays(today, 30)}`)).status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
describe("calculation helpers", () => {
  it("summarizeWork counts by type", () => {
    expect(summarizeWork("MAAPVALI", [{ kind: "MAAP", maaps: 3 }, { kind: "MAAP", maaps: 4 }, { kind: "PAYMENT" }])).toEqual({ maaps: 7, workDays: 2 });
    expect(summarizeWork("PATLAVALE", [{ kind: "PRODUCTION", maaps: 4, payableBricks: 1000 }])).toEqual({ maaps: 4, physicalBricks: 1100, payableBricks: 1000, entries: 1 });
    expect(summarizeWork("BIGARI", [{ kind: "ATTENDANCE", status: "PRESENT", units: 1 }, { kind: "ATTENDANCE", status: "HALF_DAY", units: 0.5 }])).toEqual({ presentDays: 1, halfDays: 1, absentDays: 0, workingUnits: 1.5 });
  });

  it("records of the wrong type never create earnings (a stray maap entry on a Bigari)", () => {
    const stray = { maap: [{ _id: "m1", date: "2026-11-01", numberOfMaaps: 10, ratePaise: 25000, earningsPaise: 62500 }], production: [{ _id: "p1", date: "2026-11-01", numberOfMaaps: 5, payableBricks: 1250, ratePaise: 65000, earningsPaise: 81250 }] };
    expect(buildLedger({ labourType: "BIGARI" }, stray)).toEqual([]);
    expect(buildLedger({ labourType: "MAAPVALI" }, stray)).toHaveLength(1);
    expect(buildLedger({ labourType: "PATLAVALE" }, stray)).toHaveLength(1);
  });

  it("amounts are exact paise with no floating-point drift", () => {
    const payments = [0.1, 0.2, 0.3].map((r, i) => ({ _id: `p${i}`, date: "2026-11-01", type: "SALARY_PAYMENT", amountPaise: Math.round(r * 100), method: "CASH" }));
    const a = summarizeAccount("BIGARI", buildLedger({ labourType: "BIGARI" }, { payments }), "0000-01-01", "2026-11-30");
    expect(a.period.receivedPaise).toBe(60);
  });
});

// ---------------------------------------------------------------------------
describe("salary is read-only", () => {
  it("the salary modules never write to any collection", () => {
    for (const file of ["services/salary.service.js", "services/salaryCalculations.js", "controllers/salary.controller.js", "routes/salary.routes.js"]) {
      const code = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
      for (const write of [".create(", ".updateOne(", ".updateMany(", ".deleteOne(", ".deleteMany(", ".save(", ".insertMany(", ".findOneAndUpdate("]) expect(code, `${file} ${write}`).not.toContain(write);
    }
    expect(readFileSync(new URL("../routes/salary.routes.js", import.meta.url), "utf8")).not.toMatch(/router\.(post|put|patch|delete)/);
  });

  it("asking for salary changes no stored record", async () => {
    const { bigari } = await fixture();
    const before = [workSnapshot(), JSON.stringify([...db.payments.values()])];
    await salary(RANGE());
    await statement(bigari, RANGE());
    await salary();
    expect([workSnapshot(), JSON.stringify([...db.payments.values()])]).toEqual(before);
  });
});
