// FAKE-DATABASE tests for settlement payments and explicit carry-forward decisions (S3). No MongoDB, no network, no .env.
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
const { db, makeDocModel, makeAttendanceModel, makeCounterModel, makeLabourModel, makeMaapEntryModel, makePaymentModel, makeProductionEntryModel, makeRateModel, makeSeasonModel } = await import("./helpers/memoryDb.js");
const users = vi.hoisted(() => ({ list: [] }));

vi.mock("../config/db.js", () => ({ getDbStatus: async () => ({ status: "connected", name: "test" }) }));
vi.mock("../models/User.js", () => ({
  default: { findById: (id) => ({ lean: async () => users.list.find((u) => String(u._id) === String(id)) ?? null }) },
}));
vi.mock("../models/Counter.js", () => ({ default: makeCounterModel() }));
// The new collections live in two in-memory maps. The fake transaction also restores them if the work throws (all-or-nothing), and runs one
// transaction at a time (a real database serialises conflicting transactions, and the loser retries against the winner's result).
const settle = vi.hoisted(() => ({ settlements: new Map(), statements: new Map(), decisions: new Map(), locks: new Map(), lockCalls: 0, queue: Promise.resolve(), failStatementAt: null }));
vi.mock("../utils/transaction.js", () => ({
  runInTransaction: (work) => {
    const run = settle.queue.then(async () => {
      const saved = [new Map(settle.settlements), new Map(settle.statements), new Map(settle.decisions), new Map(settle.locks)];
      try {
        return await db.transaction(() => work(null));
      } catch (err) {
        settle.settlements.clear();
        settle.statements.clear();
        settle.decisions.clear();
        settle.locks.clear();
        for (const [k, v] of saved[0]) settle.settlements.set(k, v);
        for (const [k, v] of saved[1]) settle.statements.set(k, v);
        for (const [k, v] of saved[2]) settle.decisions.set(k, v);
        for (const [k, v] of saved[3]) settle.locks.set(k, v);
        throw err;
      }
    });
    settle.queue = run.catch(() => {});
    return run;
  },
}));
vi.mock("../models/SeasonSettlement.js", async (importOriginal) => {
  const original = await importOriginal();
  return { ...original, default: makeDocModel(original.default, settle.settlements, { unique: (row, rows) => rows.some((r) => r.seasonId === row.seasonId) }) };
});
vi.mock("../models/SettlementStatement.js", async (importOriginal) => {
  const original = await importOriginal();
  return {
    ...original,
    default: makeDocModel(original.default, settle.statements, {
      unique: (row, rows) => rows.some((r) => r.seasonId === row.seasonId && r.labourId === row.labourId),
      hook: (_data, index) => {
        if (settle.failStatementAt === index) throw new Error("simulated database fault while saving statements");
      },
    }),
  };
});
vi.mock("../models/SettlementDecision.js", async (importOriginal) => {
  const original = await importOriginal();
  return { ...original, default: makeDocModel(original.default, settle.decisions, { unique: (row, rows) => rows.some((r) => r.statementId === row.statementId) }) };
});
vi.mock("../models/SettlementLock.js", () => ({
  default: {
    async updateOne(filter, update, options = {}) {
      settle.lockCalls += 1;
      let row = [...settle.locks.values()].find((r) => r.statementId === filter.statementId);
      if (!row) {
        if (!options.upsert) return { matchedCount: 0, modifiedCount: 0 };
        row = { _id: `lock-${settle.locks.size + 1}`, statementId: filter.statementId, ...structuredClone(update.$setOnInsert ?? {}), version: 0 };
        settle.locks.set(row._id, row);
      }
      for (const [k, by] of Object.entries(update.$inc ?? {})) row[k] = (row[k] ?? 0) + by;
      return { matchedCount: 1, modifiedCount: 1 };
    },
  },
}));
vi.mock("../models/Labour.js", async (importOriginal) => ({ default: makeLabourModel((await importOriginal()).default) }));
vi.mock("../models/LabourRateHistory.js", async (importOriginal) => ({ default: makeRateModel((await importOriginal()).default) }));
vi.mock("../models/Attendance.js", () => ({ default: makeAttendanceModel() }));
vi.mock("../models/MaapEntry.js", () => ({ default: makeMaapEntryModel() }));
vi.mock("../models/Season.js", async (importOriginal) => ({ default: makeSeasonModel((await importOriginal()).default) }));
vi.mock("../models/ProductionEntry.js", () => ({ default: makeProductionEntryModel() }));
vi.mock("../models/Payment.js", async (importOriginal) => {
  const base = makePaymentModel((await importOriginal()).default);
  return { default: { ...base, create: (data) => (Array.isArray(data) ? Promise.all(data.map((d) => base.create(d))) : base.create(data)) } }; // the service uses create([doc], { session })
});

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
  return res.body.data;};

const salary = async (q = "") => (await asOwner("get", `/api/salary${q}`)).body;
const preview = (seasonId, q = "") => asOwner("get", `/api/seasons/${seasonId}/settlement-preview${q}`);
const close = (season, body = {}) => asOwner("post", `/api/seasons/${season.id}/close`, { endDate: today, revision: season.revision, ...body });
const getSettlement = (season) => asOwner("get", `/api/seasons/${season.id}/settlement`);
const seasonRow = (id) => db.seasons.get(id);
const sources = () => JSON.stringify([[...db.attendance.values()], [...db.maap.values()], [...db.production.values()], [...db.payments.values()], db.rates, [...db.labours.values()]]);
const dropRates = (w) => {
  for (let i = db.rates.length - 1; i >= 0; i -= 1) if (db.rates[i].labourId === w.id) db.rates.splice(i, 1);
};
const makeSeason = async (name, startDate, endDate) => {
  const res = await asOwner("post", "/api/seasons", { name, startDate, ...(endDate ? { endDate } : {}) });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.data;
};
const markAttendance = async (w, d, status = "PRESENT") => expect((await asOwner("put", `/api/attendance/${D(d)}`, { entries: [{ labourId: w.id, status }], reason: "Late entry" })).status).toBe(200);

/** The KNOWN TEST DATA of salary.test.js: Bigari 2,675 earned / Maapvali 1,300 / Patlavale 2,062.50, with payments. */
const fixture = async (seasonStart = D(90)) => {
  const season = await makeSeason("Season 2026-27", seasonStart);
  const [bigari, maapvali, patlavale] = [await makeLabour("BIGARI"), await makeLabour("MAAPVALI"), await makeLabour("PATLAVALE")];
  for (const [w, rate, from] of [[bigari, 700, D(3)], [maapvali, 300, D(3)], [patlavale, 800, D(1)]]) expect((await changeRate(w, rate, from)).status).toBe(201);
  for (const [d, status] of [[10, "PRESENT"], [8, "HALF_DAY"], [5, "PRESENT"], [2, "PRESENT"], [1, "HALF_DAY"]]) await markAttendance(bigari, d, status);
  for (const [d, maaps] of [[9, 10], [4, 6], [1, 4]]) expect((await asOwner("put", `/api/maap-entries/day/${D(d)}`, { rows: [{ labourId: maapvali.id, maaps }], reason: "Late entry" })).status).toBe(200);
  for (const [d, maaps] of [[7, 4], [2, 5], [0, 3]]) expect((await asOwner("put", `/api/production-entries/day/${D(d)}`, { rows: [{ teamId: patlavale.id, maaps }], reason: "Late entry" })).status).toBe(200);
  await pay(bigari, { type: "BOOKING_ADVANCE", amount: 1000, date: D(30) });
  await pay(bigari, { amount: 800, date: D(6) });
  await pay(bigari, { amount: 500, date: D(0) });
  await pay(maapvali, { amount: 200, date: D(2) });
  await pay(patlavale, { type: "BOOKING_ADVANCE", amount: 500, date: D(3) });
  const fresh = (await asOwner("get", `/api/seasons/${season.id}`)).body.data; // production saves raised the revision
  return { season: fresh, bigari, maapvali, patlavale };
};

beforeEach(() => {
  today = todayBusinessDate();
  db.reset();
  settle.settlements.clear();
  settle.statements.clear();
  settle.decisions.clear();
  settle.locks.clear();
  settle.lockCalls = 0;
  db.beforePaymentCreate = null;
  settle.failStatementAt = null;
  settle.queue = Promise.resolve();
  users.list.length = 0;
  mobileSeq = 0;
  owner = addUser("OWNER");
  manager = addUser("MANAGER", "Helper");
  app = createApp();
});
afterEach(() => vi.useRealTimers());

let rid = 0;
const newRid = () => `rid-${String((rid += 1)).padStart(5, "0")}-test`;
const statementOf = (data, w) => data.statements.find((s) => s.labourId === w.id);
const progressFor = (data, w) => data.progress.find((p) => p.labourId === w.id);
const payUrl = (season, st) => `/api/seasons/${season.id}/statements/${st.id}/payments`;
const payS = (season, st, body = {}, cookie = owner.cookie) => send("post", payUrl(season, st), cookie, { amount: 100, paidOn: today, requestId: newRid(), ...body });
const decideUrl = (season, st) => `/api/seasons/${season.id}/statements/${st.id}/carry-forward`;
const decide = (season, st, body = { reason: "Owner will recover it next season", confirm: true }, cookie = owner.cookie) => send("post", decideUrl(season, st), cookie, body);
const view = async (season) => (await getSettlement(season)).body.data;
const livePayments = () => [...db.payments.values()].filter((p) => !p.isDeleted);
const settlementPayments = () => [...db.payments.values()].filter((p) => p.settlementId);

/** Season closed on D(3). A (Bigari 4 days x 650 = 2,600 payable), M (Maapvali 8 maaps = 2 x 250 = 500 payable), B (1 day = 650, Bayana 1,000: -350 recoverable). */
const mini = async () => {
  const season = await makeSeason("Season 2026-27", D(90));
  const [A, M, B] = [await makeLabour("BIGARI"), await makeLabour("MAAPVALI"), await makeLabour("BIGARI")];
  for (const d of [10, 9, 8, 7]) await markAttendance(A, d);
  await markAttendance(B, 6);
  expect((await asOwner("put", `/api/maap-entries/day/${D(8)}`, { rows: [{ labourId: M.id, maaps: 8 }], reason: "Late entry" })).status).toBe(200);
  await pay(B, { type: "BOOKING_ADVANCE", amount: 1000, date: D(30) });
  const fresh = (await asOwner("get", `/api/seasons/${season.id}`)).body.data;
  const res = await close(fresh, { endDate: D(3) });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const data = await view(fresh);
  return { season: fresh, A, M, B, data, sA: statementOf(data, A), sM: statementOf(data, M), sB: statementOf(data, B) };
};

describe("fixture sanity", () => {
  it("closes with A payable 2,600, M payable 500 and B recoverable 350, nothing paid yet", async () => {
    const { data, sA, sM, sB } = await mini();
    expect(sA).toMatchObject({ status: "PAYABLE", payablePaise: 260_000 });
    expect(sM).toMatchObject({ status: "PAYABLE", payablePaise: 50_000 });
    expect(sB).toMatchObject({ status: "RECOVERABLE", recoverablePaise: 35_000, closingPaise: -35_000 });
    expect(data.summary).toMatchObject({ status: "OUTSTANDING", fullySettled: false, paidPaise: 0, remainingPaise: 310_000, pendingDecisions: 1, outstanding: 2 });
    expect(settlementPayments()).toHaveLength(0);
  });
});

describe("recording settlement payments", () => {
  it("a full payment settles the worker; ledger date is the season end, the actual payment date is kept separately", async () => {
    const { season, A, sA } = await mini();
    const res = await payS(season, sA, { amount: 2600, paidOn: today, method: "UPI", reference: "UTR1" });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const { payment, replayed, progress } = res.body.data;
    expect(replayed).toBe(false);
    expect(payment).toMatchObject({ recipientId: A.id, type: "SALARY_PAYMENT", amount: 2600, date: D(3), method: "UPI", reference: "UTR1", settlement: { seasonId: season.id, statementId: sA.id, ledgerDate: D(3), paidOn: today } });
    expect(payment.note).toContain("Final settlement");
    expect(progress.find((p) => p.labourId === A.id)).toMatchObject({ status: "SETTLED", paidPaise: 260_000, remainingPaise: 0, remaining: 0 });
    expect(D(3)).not.toBe(today);
  });

  it("partial and multiple payments show the exact remaining amount until it reaches zero", async () => {
    const { season, A, sA } = await mini();
    let r = await payS(season, sA, { amount: 1000.5 });
    expect(r.status).toBe(201);
    expect(progressFor(r.body.data, A)).toMatchObject({ status: "PARTIALLY_SETTLED", paidPaise: 100_050, remainingPaise: 159_950, remaining: 1599.5 });
    r = await payS(season, sA, { amount: 599.5 });
    expect(progressFor(r.body.data, A)).toMatchObject({ status: "PARTIALLY_SETTLED", remainingPaise: 100_000 });
    expect(r.body.data.summary.status).toBe("PARTIALLY_SETTLED");
    r = await payS(season, sA, { amount: 1000 });
    expect(progressFor(r.body.data, A)).toMatchObject({ status: "SETTLED", remainingPaise: 0, paidPaise: 260_000 });
    expect(progressFor(r.body.data, A).payments).toHaveLength(3);
    expect(settlementPayments()).toHaveLength(3);
  });

  it("refuses an amount above the remaining payable and saves nothing", async () => {
    const { season, A, sA } = await mini();
    let r = await payS(season, sA, { amount: 2600.01 });
    expect(r.status).toBe(409);
    expect(JSON.stringify(r.body)).toContain("2600");
    expect(settlementPayments()).toHaveLength(0);
    expect((await payS(season, sA, { amount: 2000 })).status).toBe(201);
    r = await payS(season, sA, { amount: 600.01 });
    expect(r.status).toBe(409);
    expect(JSON.stringify(r.body)).toContain("600");
    expect((await payS(season, sA, { amount: 600 })).status).toBe(201);
    r = await payS(season, sA, { amount: 1 });
    expect(r.status).toBe(409);
    expect(JSON.stringify(r.body)).toContain("fully paid");
    expect(progressFor(await view(season), A)).toMatchObject({ paidPaise: 260_000, remainingPaise: 0 });
    expect(settlementPayments()).toHaveLength(2);
  });

  it("requires a requestId; a retry returns the first payment instead of paying twice; a different payment under the same requestId is refused", async () => {
    const { season, sA } = await mini();
    const noId = await send("post", payUrl(season, sA), owner.cookie, { amount: 100, paidOn: today });
    expect(noId.status).toBe(400);
    const requestId = newRid();
    const first = await payS(season, sA, { amount: 700, requestId });
    expect(first.status).toBe(201);
    const retry = await payS(season, sA, { amount: 700, requestId });
    expect(retry.status).toBe(200);
    expect(retry.body.data).toMatchObject({ replayed: true });
    expect(retry.body.data.payment.id).toBe(first.body.data.payment.id);
    expect(settlementPayments()).toHaveLength(1);
    expect((await payS(season, sA, { amount: 701, requestId })).status).toBe(409);
    expect((await payS(season, sA, { amount: 700, requestId, paidOn: D(1) })).status).toBe(409);
    expect(settlementPayments()).toHaveLength(1);
    expect(progressFor(await view(season), { id: sA.labourId })).toMatchObject({ paidPaise: 70_000 });
  });

  it("two simultaneous payments cannot together exceed the payable amount; two copies of one request make one payment", async () => {
    const { season, sA } = await mini();
    const [x, y] = await Promise.all([payS(season, sA, { amount: 2000 }), payS(season, sA, { amount: 2000 })]);
    expect([x.status, y.status].sort()).toEqual([201, 409]);
    expect(settlementPayments()).toHaveLength(1);
    const requestId = newRid();
    const [p, q] = await Promise.all([payS(season, sA, { amount: 600, requestId }), payS(season, sA, { amount: 600, requestId })]);
    expect([p.status, q.status].sort()).toEqual([200, 201]);
    expect(settlementPayments()).toHaveLength(2);
    const total = settlementPayments().reduce((t, r) => t + r.amountPaise, 0);
    expect(total).toBe(260_000);
  });

  it("every payment takes the worker's lock record first (serialising payments for that worker)", async () => {
    const { season, sA, sM } = await mini();
    await payS(season, sA, { amount: 100 });
    await payS(season, sA, { amount: 100 });
    await payS(season, sM, { amount: 100 });
    const locks = [...settle.locks.values()];
    expect(locks).toHaveLength(2);
    expect(locks.find((l) => l.statementId === sA.id).version).toBe(2);
    expect(locks.find((l) => l.statementId === sM.id).version).toBe(1);
  });

  it("is traceable: worker, season, settlement and statement are stored on the payment, which also appears in the ordinary payment history", async () => {
    const { season, A, sA, data } = await mini();
    const res = await payS(season, sA, { amount: 900, paidOn: D(1) });
    expect(res.status).toBe(201);
    const row = settlementPayments()[0];
    expect(row).toMatchObject({ recipientId: A.id, seasonId: season.id, settlementId: data.settlement.id, statementId: sA.id, type: "SALARY_PAYMENT", date: D(3), paidOn: D(1), amountPaise: 90_000, isDeleted: false });
    const list = (await asOwner("get", `/api/payments?recipientId=${A.id}`)).body;
    const item = list.data.find((i) => i.id === String(row._id));
    expect(item.settlement).toMatchObject({ statementId: sA.id, ledgerDate: D(3), paidOn: D(1) });
    expect(JSON.stringify(list.meta)).toContain("900");
  });

  it("rejects bad input and wrong targets", async () => {
    const { season, sA, sB, data } = await mini();
    expect((await payS(season, sA, { amount: 0 })).status).toBe(400);
    expect((await payS(season, sA, { amount: 10.123 })).status).toBe(400);
    expect((await payS(season, sA, { amount: "100" })).status).toBe(400);
    expect((await payS(season, sA, { requestId: "short" })).status).toBe(400);
    expect((await payS(season, sA, { paidOn: addDays(today, 1) })).status).toBe(400); // future
    expect((await payS(season, sA, { paidOn: D(5) })).status).toBe(400); // before the season ended
    expect((await send("post", payUrl(season, sA), owner.cookie, { amount: 5, paidOn: today, requestId: newRid(), date: D(9) })).status).toBe(400); // client cannot choose the ledger date
    expect((await payS(season, sA, {}, manager.cookie)).status).toBe(403);
    expect((await send("post", payUrl(season, sA), undefined, {})).status).toBe(401);
    expect((await payS(season, { id: "f".repeat(24) })).status).toBe(404);
    expect((await payS({ id: "e".repeat(24) }, sA)).status).toBe(404);
    const other = await makeSeason("Other season", addDays(today, 2));
    expect((await payS(other, sA)).status).toBe(404); // statement belongs to another season
    expect((await payS(season, sB)).status).toBe(409); // recoverable worker: nothing to pay
    expect(settlementPayments()).toHaveLength(0);
    expect(data.statements).toHaveLength(3);
  });

  it("a settlement payment's amount, type and date cannot be corrected; note and reference can", async () => {
    const { season, sA } = await mini();
    const id = (await payS(season, sA, { amount: 500 })).body.data.payment.id;
    for (const change of [{ amount: 400 }, { date: D(2) }, { type: "OTHER", note: "x" }]) {
      const r = await send("patch", `/api/payments/${id}`, owner.cookie, { ...change, reason: "Fix" });
      expect(r.status, JSON.stringify(change)).toBe(409);
    }
    const ok = await send("patch", `/api/payments/${id}`, owner.cookie, { reference: "UTR-9", reason: "Add reference" });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(db.payments.get(id)).toMatchObject({ amountPaise: 50_000, date: D(3), reference: "UTR-9", revision: 2 });
  });
});

describe("voiding a settlement payment reopens the balance", () => {
  it("restores the remaining payable, keeps the voided payment in the history with its reason, and allows paying again", async () => {
    const { season, A, sA } = await mini();
    const id = (await payS(season, sA, { amount: 2600 })).body.data.payment.id;
    expect(progressFor(await view(season), A).status).toBe("SETTLED");
    const v = await send("delete", `/api/payments/${id}`, owner.cookie, { reason: "Entered on the wrong worker" });
    expect(v.status, JSON.stringify(v.body)).toBe(200);
    const after = progressFor(await view(season), A);
    expect(after).toMatchObject({ status: "OUTSTANDING", paidPaise: 0, remainingPaise: 260_000 });
    expect(after.payments).toHaveLength(1);
    expect(after.payments[0]).toMatchObject({ id, isDeleted: true, deletedReason: "Entered on the wrong worker", settlement: { statementId: sA.id } });
    expect(db.payments.get(id)).toMatchObject({ isDeleted: true, amountPaise: 260_000 }); // never erased
    expect((await view(season)).summary.fullySettled).toBe(false);
    const again = await payS(season, sA, { amount: 2600 });
    expect(again.status).toBe(201);
    expect(progressFor(again.body.data, A)).toMatchObject({ status: "SETTLED", paidPaise: 260_000 });
  });

  it("a partial payment that is voided leaves the earlier ones counted", async () => {
    const { season, A, sA } = await mini();
    await payS(season, sA, { amount: 1000 });
    const id = (await payS(season, sA, { amount: 500 })).body.data.payment.id;
    await send("delete", `/api/payments/${id}`, owner.cookie, { reason: "Duplicate entry" });
    expect(progressFor(await view(season), A)).toMatchObject({ status: "PARTIALLY_SETTLED", paidPaise: 100_000, remainingPaise: 160_000 });
  });
});

describe("negative balances need an explicit carry-forward decision", () => {
  it("records the decision for the worker and season without paying, deducting or writing anything off", async () => {
    const { season, B, sB, data } = await mini();
    const before = sources();
    const res = await decide(season, sB);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data.decision).toMatchObject({ kind: "CARRY_FORWARD", amountPaise: 35_000, amount: 350, labourId: B.id, seasonId: season.id, settlementId: data.settlement.id, statementId: sB.id, ledgerDate: D(3), reason: "Owner will recover it next season" });
    expect(res.body.data.decision.decidedBy).toMatchObject({ name: "Ramesh Patel" });
    expect(progressFor(res.body.data, B)).toMatchObject({ status: "CARRIED_FORWARD", remainingPaise: 0 });
    // the immutable statement still shows the original negative amount, and nothing else moved
    expect(statementOf(await view(season), B)).toEqual(sB);
    expect(sB).toMatchObject({ status: "RECOVERABLE", closingPaise: -35_000, recoverablePaise: 35_000 });
    expect(sources()).toBe(before);
    expect(settlementPayments()).toHaveLength(0);
  });

  it("needs both a reason and an explicit confirmation", async () => {
    const { season, sB } = await mini();
    for (const body of [{ reason: "ok reason" }, { confirm: true }, { reason: "ok reason", confirm: false }, { reason: "  ", confirm: true }, { reason: "ok reason", confirm: "true" }, { reason: "ok reason", confirm: true, amount: 0 }]) {
      expect((await decide(season, sB, body)).status, JSON.stringify(body)).toBe(400);
    }
    expect(settle.decisions.size).toBe(0);
    expect((await decide(season, sB, undefined, manager.cookie)).status).toBe(403);
  });

  it("is written once: a repeat with the same reason is returned, a different reason is refused, and one row exists", async () => {
    const { season, sB } = await mini();
    expect((await decide(season, sB)).status).toBe(201);
    const again = await decide(season, sB);
    expect(again.status).toBe(200);
    expect(again.body.data.replayed).toBe(true);
    expect((await decide(season, sB, { reason: "A different reason", confirm: true })).status).toBe(409);
    const [x, y] = await Promise.all([decide(season, sB), decide(season, sB)]);
    expect([x.status, y.status].every((s) => s === 200)).toBe(true);
    expect(settle.decisions.size).toBe(1);
  });

  it("is only for a negative balance, and a negative balance can never be paid", async () => {
    const { season, sA, sB } = await mini();
    expect((await decide(season, sA)).status).toBe(409);
    expect((await payS(season, sB, { amount: 10 })).status).toBe(409);
    expect((await decide({ id: "f".repeat(24) }, sB)).status).toBe(404);
    expect(settle.decisions.size).toBe(0);
  });

  it("works while no next season exists", async () => {
    const { season, sB } = await mini();
    expect((await asOwner("get", "/api/seasons")).body.data.filter((s) => s.id !== season.id)).toHaveLength(0);
    expect((await decide(season, sB)).status).toBe(201);
  });
});

describe("the season is settled only when every payable is zero and every negative balance has a decision", () => {
  it("walks outstanding -> partially settled -> pending decision -> settled", async () => {
    const { season, sA, sM, sB } = await mini();
    expect((await view(season)).summary).toMatchObject({ status: "OUTSTANDING", fullySettled: false });
    await payS(season, sA, { amount: 2600 });
    expect((await view(season)).summary).toMatchObject({ status: "PARTIALLY_SETTLED", fullySettled: false, settled: 1, outstanding: 1, pendingDecisions: 1, remainingPaise: 50_000 });
    await payS(season, sM, { amount: 500 });
    const mid = (await view(season)).summary;
    expect(mid).toMatchObject({ status: "PENDING_DECISION", fullySettled: false, settled: 2, pendingDecisions: 1, remainingPaise: 0, paidPaise: 310_000 });
    await decide(season, sB);
    expect((await view(season)).summary).toMatchObject({ status: "SETTLED", fullySettled: true, pendingDecisions: 0, carriedForward: 1, settled: 2 });
  });

  it("voiding a payment after full settlement reopens the season", async () => {
    const { season, sA, sM, sB } = await mini();
    const id = (await payS(season, sA, { amount: 2600 })).body.data.payment.id;
    await payS(season, sM, { amount: 500 });
    await decide(season, sB);
    expect((await view(season)).summary.fullySettled).toBe(true);
    await send("delete", `/api/payments/${id}`, owner.cookie, { reason: "Paid twice by mistake" });
    expect((await view(season)).summary).toMatchObject({ fullySettled: false, status: "PARTIALLY_SETTLED", remainingPaise: 260_000 });
  });
});

describe("snapshots, source records and history stay unchanged", () => {
  it("statements and the settlement never change, and no attendance, production, Maapvali, rate or earlier payment is touched", async () => {
    const { season, sA, sM, sB } = await mini();
    const snapshot = JSON.stringify([[...settle.settlements.values()], [...settle.statements.values()]]);
    const sourcesBefore = sources();
    const olderPayments = JSON.stringify([...db.payments.values()]);
    const seasonBefore = JSON.stringify(seasonRow(season.id));
    await payS(season, sA, { amount: 1000 });
    await payS(season, sA, { amount: 1600 });
    await payS(season, sM, { amount: 500 });
    await decide(season, sB);
    const last = [...db.payments.values()].find((p) => p.settlementId);
    await send("delete", `/api/payments/${last._id}`, owner.cookie, { reason: "Entered twice" });
    expect(JSON.stringify([[...settle.settlements.values()], [...settle.statements.values()]])).toBe(snapshot);
    const nonSettlement = JSON.stringify([...db.payments.values()].filter((p) => !p.settlementId));
    expect(nonSettlement).toBe(JSON.stringify(JSON.parse(olderPayments)));
    expect(sources().replace(/"settlementId":"[^"]*"/g, "")).not.toBe(""); // sanity
    // attendance, maap, production, rates and labours are byte-for-byte what they were
    const only = (s) => JSON.stringify(JSON.parse(s).slice(0, 3).concat(JSON.parse(s).slice(4)));
    expect(only(sources())).toBe(only(sourcesBefore));
    expect(JSON.stringify(seasonRow(season.id))).toBe(seasonBefore);
  });

  it("the later statement and ledger treat a settlement payment as an ordinary salary payment dated the season end", async () => {
    const { season, A, sA } = await mini();
    await payS(season, sA, { amount: 600, paidOn: today });
    const history = (await asOwner("get", `/api/payments?recipientId=${A.id}`)).body;
    expect(history.data.filter((p) => p.type === "SALARY_PAYMENT" && p.date === D(3))).toHaveLength(1);
    expect(JSON.stringify(history.meta)).toContain("600");
  });
});

describe("all-or-nothing", () => {
  it("a database fault while saving the payment rolls back the lock too, and a retry with the same requestId succeeds exactly once", async () => {
    const { season, sA } = await mini();
    const requestId = newRid();
    let fail = true;
    db.beforePaymentCreate = () => {
      if (fail) {
        fail = false;
        throw new Error("simulated database fault while saving the payment");
      }
    };
    const bad = await payS(season, sA, { amount: 800, requestId });
    expect(bad.status).toBe(500);
    expect(settlementPayments()).toHaveLength(0);
    expect(settle.locks.size).toBe(0);
    const ok = await payS(season, sA, { amount: 800, requestId });
    expect(ok.status).toBe(201);
    expect(settlementPayments()).toHaveLength(1);
    expect((await payS(season, sA, { amount: 800, requestId })).body.data.replayed).toBe(true);
    expect(settlementPayments()).toHaveLength(1);
  });

  it("a fault while saving a decision leaves no decision", async () => {
    const { season, sB } = await mini();
    const real = settle.decisions.set.bind(settle.decisions);
    settle.decisions.set = () => {
      throw new Error("simulated database fault while saving the decision");
    };
    const bad = await decide(season, sB);
    settle.decisions.set = real;
    expect(bad.status).toBe(500);
    expect(settle.decisions.size).toBe(0);
    expect((await decide(season, sB)).status).toBe(201);
  });
});

describe("new records are append-only and the code writes nothing else", () => {
  it("a recorded decision cannot be updated, replaced, deleted or re-saved", async () => {
    const real = await vi.importActual("../models/SeasonSettlement.js");
    const { default: Real } = await vi.importActual("../models/SettlementDecision.js");
    for (const op of ["updateOne", "updateMany", "findOneAndUpdate", "replaceOne", "deleteOne", "deleteMany", "bulkWrite"]) {
      const hooks = Real.schema.s.hooks._pres.get(op) ?? [];
      expect(hooks.some((h) => h.fn === real.refuseChanges), op).toBe(true);
    }
    await expect(Real.updateOne({ statementId: "x" }, { $set: { reason: "changed" } }).exec()).rejects.toMatchObject({ code: "IMMUTABLE_RECORD" });
    const stored = Real.hydrate({ _id: new mongoose.Types.ObjectId() });
    await expect(stored.save({ validateBeforeSave: false })).rejects.toMatchObject({ code: "IMMUTABLE_RECORD" });
  });

  it("source checks: transaction required, lock before reading what was paid, and no writes to statements, settlements, attendance, production, rates or seasons", () => {
    const code = readFileSync(new URL("../services/settlementPayment.service.js", import.meta.url), "utf8").split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
    expect(code).not.toMatch(/\b(Attendance|MaapEntry|ProductionEntry|Labour|LabourRateHistory|Season|SeasonSettlement|SettlementStatement)\.(create|insertMany|insertOne|updateOne|updateMany|deleteOne|deleteMany|bulkWrite|findOneAndUpdate|save)\(/);
    expect(code).not.toMatch(/Payment\.(updateOne|updateMany|deleteOne|deleteMany|findOneAndUpdate)\(/);
    expect(code.match(/\{ required: true \}/g)).toHaveLength(2);
    expect(code.indexOf("SettlementLock.updateOne(")).toBeGreaterThan(-1);
    expect(code.indexOf("SettlementLock.updateOne(")).toBeLessThan(code.indexOf("paymentsOf(statementId, session)"));
    expect(code).not.toMatch(/process\.env|dotenv/);
  });

  it("the two new models are registered for index synchronisation (not run), and the original payment path keeps its rules", () => {
    const sync = readFileSync(new URL("../scripts/syncIndexes.js", import.meta.url), "utf8");
    expect(sync).toContain("models/SettlementDecision.js");
    expect(sync).toContain("models/SettlementLock.js");
    const seasonSvc = readFileSync(new URL("../services/settlement.service.js", import.meta.url), "utf8");
    expect(seasonSvc).not.toContain("payment.service");
  });
});

describe("ordinary payments are unaffected", () => {
  it("an ordinary payment has no settlement link and can still be created, corrected and voided", async () => {
    const { A } = await mini();
    const p = await pay(A, { amount: 50, date: today });
    expect(p.settlement).toBeUndefined();
    const fix = await send("patch", `/api/payments/${p.id}`, owner.cookie, { amount: 60, reason: "Typo" });
    expect(fix.status).toBe(200);
    expect((await send("delete", `/api/payments/${p.id}`, owner.cookie, { reason: "Wrong worker" })).status).toBe(200);
  });
});
