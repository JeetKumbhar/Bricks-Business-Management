
// FAKE-DATABASE tests for closed-season write guards (S4). No MongoDB, no network, no .env.
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
        return await db.transaction(() => work({ fake: "session" })); // a non-null session, so the season fence really runs
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
const newRid = () => `rid-${String((rid += 1)).padStart(5, "0")}-guard`;
const payUrl = (season, st) => `/api/seasons/${season.id}/statements/${st.id}/payments`;
const payS = (season, st, body = {}) => send("post", payUrl(season, st), owner.cookie, { amount: 100, paidOn: today, requestId: newRid(), ...body });
const view = async (season) => (await getSettlement(season)).body.data;
const putAtt = (w, d, status = "PRESENT", cookie = owner.cookie) => send("put", `/api/attendance/${D(d)}`, cookie, { entries: [{ labourId: w.id, status }], reason: "Late entry" });
const putMaap = (rows, d) => asOwner("put", `/api/maap-entries/day/${D(d)}`, { rows, reason: "Late entry" });
const postPay = (w, o = {}) => asOwner("post", "/api/payments", { recipientId: w.id, type: "SALARY_PAYMENT", amount: 50, date: D(10), ...o });
const state = () => JSON.stringify([[...db.attendance.values()], [...db.maap.values()], [...db.payments.values()], [...settle.settlements.values()], [...settle.statements.values()]]);
const closedBody = (res) => JSON.stringify(res.body);

/** Season "Season 2026-27" D(90)..D(3), CLOSED. A: Bigari (attendance D10..D7), M: Maapvali (8 maaps D8), B: Bigari (D6, Bayana D30). X joined D(100). */
const closedSeason = async () => {
  const season = await makeSeason("Season 2026-27", D(90));
  const [A, M, B] = [await makeLabour("BIGARI"), await makeLabour("MAAPVALI"), await makeLabour("BIGARI")];
  const X = await makeLabour("BIGARI", { joiningDate: D(100) });
  for (const d of [10, 9, 8, 7]) await markAttendance(A, d);
  await markAttendance(B, 6);
  expect((await putMaap([{ labourId: M.id, maaps: 8 }], 8)).status).toBe(200);
  await pay(B, { type: "BOOKING_ADVANCE", amount: 1000, date: D(30) });
  const fresh = (await asOwner("get", `/api/seasons/${season.id}`)).body.data;
  const res = await close(fresh, { endDate: D(3) });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const data = await view(fresh);
  return { season: fresh, A, M, B, X, data, sA: data.statements.find((s) => s.labourId === A.id) };
};

describe("attendance in a closed season", () => {
  it("a new or edited entry dated inside the season is refused with a clear 409, and nothing changes", async () => {
    const { A, B } = await closedSeason();
    const before = state();
    const created = await putAtt(B, 20); // new record, inside the season
    expect(created.status, closedBody(created)).toBe(409);
    expect(created.body.errors[0]).toMatchObject({ field: "date", code: "SEASON_CLOSED" });
    for (const word of ["Season 2026-27", D(20), D(90), D(3), "closed", "Ordinary attendance", "settlement"]) expect(closedBody(created), word).toContain(word);
    expect((await putAtt(A, 9, "ABSENT")).status).toBe(409); // edit of an existing record
    expect(state()).toBe(before);
    expect(db.attendance.get(`${A.id}|${D(9)}`)).toMatchObject({ status: "PRESENT", revision: 1, history: [] });
  });

  it("a whole day is all or nothing: one worker's closed day refuses everyone's entries", async () => {
    const { A, B } = await closedSeason();
    const before = state();
    const res = await asOwner("put", `/api/attendance/${D(10)}`, { entries: [{ labourId: A.id, status: "ABSENT" }, { labourId: B.id, status: "PRESENT" }], reason: "Late entry" });
    expect(res.status).toBe(409);
    expect(state()).toBe(before);
  });

  it("the Manager is refused too (the guard is about the date, not the role)", async () => {
    const { B } = await closedSeason();
    const res = await putAtt(B, 20, "PRESENT", manager.cookie);
    expect([403, 409]).toContain(res.status);
    expect(db.attendance.has(`${B.id}|${D(20)}`)).toBe(false);
  });
});

describe("Maapvali in a closed season", () => {
  it("saving or editing a day, correcting an entry, moving it in or out, and deleting it are all refused; nothing changes", async () => {
    const { M } = await closedSeason();
    const entry = [...db.maap.values()][0];
    const outside = await putMaap([{ labourId: M.id, maaps: 4 }], 1); // after the season: not in any season, allowed
    expect(outside.status, closedBody(outside)).toBe(200);
    const outsideEntry = [...db.maap.values()].find((e) => e.date === D(1));
    const before = state();
    const checks = [
      ["new row inside", await putMaap([{ labourId: M.id, maaps: 4 }], 20)],
      ["edit inside", await putMaap([{ labourId: M.id, maaps: 9 }], 8)],
      ["PATCH maaps", await asOwner("patch", `/api/maap-entries/${entry._id}`, { numberOfMaaps: 5, reason: "Fix" })],
      ["PATCH move out", await asOwner("patch", `/api/maap-entries/${entry._id}`, { date: D(2), reason: "Move" })],
      ["PATCH move in", await asOwner("patch", `/api/maap-entries/${outsideEntry._id}`, { date: D(20), reason: "Move" })],
      ["DELETE inside", await asOwner("delete", `/api/maap-entries/${entry._id}`, { reason: "Wrong" })],
    ];
    for (const [label, res] of checks) {
      expect(res.status, `${label}: ${closedBody(res)}`).toBe(409);
      expect(closedBody(res), label).toContain("Ordinary Maapvali");
    }
    expect(state()).toBe(before);
    expect(db.maap.get(String(entry._id))).toMatchObject({ numberOfMaaps: 8, revision: 1, isDeleted: false });
  });

  it("a bulk day with several rows is refused as a whole", async () => {
    const { M } = await closedSeason();
    const M2 = await makeLabour("MAAPVALI");
    const before = state();
    const res = await putMaap([{ labourId: M.id, maaps: 4 }, { labourId: M2.id, maaps: 4 }], 12);
    expect(res.status).toBe(409);
    expect(state()).toBe(before);
  });

  it("entries outside any closed season can still be corrected and deleted", async () => {
    const { M } = await closedSeason();
    await putMaap([{ labourId: M.id, maaps: 4 }], 1);
    const e = [...db.maap.values()].find((x) => x.date === D(1));
    expect((await asOwner("patch", `/api/maap-entries/${e._id}`, { numberOfMaaps: 6, reason: "Fix" })).status).toBe(200);
    expect((await asOwner("patch", `/api/maap-entries/${e._id}`, { date: D(0), reason: "Move" })).status).toBe(200);
    expect((await asOwner("delete", `/api/maap-entries/${e._id}`, { reason: "Wrong" })).status).toBe(200);
  });
});

describe("ordinary payments in a closed season", () => {
  it("Bayana, salary and other payments dated inside the season are refused; settlement payments are not", async () => {
    const { season, A, B, sA } = await closedSeason();
    const before = state();
    for (const body of [{ type: "SALARY_PAYMENT" }, { type: "BOOKING_ADVANCE" }, { type: "OTHER", note: "Festival gift" }]) {
      const res = await postPay(A, body);
      expect(res.status, JSON.stringify(body) + closedBody(res)).toBe(409);
      expect(res.body.errors[0]).toMatchObject({ field: "date", code: "SEASON_CLOSED" });
      expect(closedBody(res)).toContain("Ordinary payments");
    }
    expect(state()).toBe(before);
    // the dedicated settlement route still works, and is dated inside the closed season by design
    const ok = await payS(season, sA, { amount: 500 });
    expect(ok.status, closedBody(ok)).toBe(201);
    expect(ok.body.data.payment).toMatchObject({ date: D(3), type: "SALARY_PAYMENT" });
    expect(B.id).toBeTruthy();
  });

  it("existing ordinary payments in the season cannot be corrected or voided, and none can be moved in or out", async () => {
    const { A } = await closedSeason();
    const inside = [...db.payments.values()].find((p) => p.date === D(30)); // B's Bayana
    const outside = await postPay(A, { date: D(1) });
    expect(outside.status, closedBody(outside)).toBe(201);
    const before = state();
    const attempts = [
      ["correct amount", asOwner("patch", `/api/payments/${inside._id}`, { amount: 5, reason: "Fix" })],
      ["correct note", asOwner("patch", `/api/payments/${inside._id}`, { note: "x", reason: "Fix" })],
      ["move out", asOwner("patch", `/api/payments/${inside._id}`, { date: D(1), reason: "Fix" })],
      ["move in", asOwner("patch", `/api/payments/${outside.body.data.id}`, { date: D(20), reason: "Fix" })],
      ["void", asOwner("delete", `/api/payments/${inside._id}`, { reason: "Wrong" })],
    ];
    for (const [label, p] of attempts) {
      const res = await p;
      expect(res.status, `${label}: ${closedBody(res)}`).toBe(409);
    }
    expect(state()).toBe(before);
    expect(db.payments.get(String(inside._id))).toMatchObject({ amountPaise: 100_000, isDeleted: false, revision: 1, type: "BOOKING_ADVANCE" });
    // a payment outside every season is still fully editable
    expect((await asOwner("patch", `/api/payments/${outside.body.data.id}`, { amount: 60, reason: "Fix" })).status).toBe(200);
    expect((await asOwner("delete", `/api/payments/${outside.body.data.id}`, { reason: "Wrong" })).status).toBe(200);
  });

  it("settlement payments can still be corrected (note), voided and re-recorded in the closed season", async () => {
    const { season, A, sA } = await closedSeason();
    const id = (await payS(season, sA, { amount: 500 })).body.data.payment.id;
    expect((await asOwner("patch", `/api/payments/${id}`, { reference: "UTR-1", reason: "Add reference" })).status).toBe(200);
    expect((await asOwner("delete", `/api/payments/${id}`, { reason: "Entered twice" })).status).toBe(200);
    expect((await payS(season, sA, { amount: 500 })).status).toBe(201);
    expect(A.id).toBeTruthy();
  });

  it("a retried request that was already recorded before the close returns the first payment", async () => {
    const season = await makeSeason("Season 2026-27", D(90));
    const w = await makeLabour("BIGARI");
    const body = { recipientId: w.id, type: "SALARY_PAYMENT", amount: 70, date: D(10), requestId: "retry-before-close" };
    expect((await asOwner("post", "/api/payments", body)).status).toBe(201);
    await markAttendance(w, 9);
    expect((await close((await asOwner("get", `/api/seasons/${season.id}`)).body.data, { endDate: D(3) })).status).toBe(201);
    const retry = await asOwner("post", "/api/payments", body);
    expect(retry.status).toBe(200);
    expect(retry.body.meta.replayed).toBe(true);
    expect([...db.payments.values()].filter((p) => p.requestId === "retry-before-close")).toHaveLength(1);
  });
});

describe("season boundaries and dates outside any season", () => {
  it("both ends of a closed season are inclusive; the day before the start and the day after the end are outside", async () => {
    const { X } = await closedSeason(); // X joined D(100); season D(90)..D(3)
    const results = {};
    for (const d of [91, 90, 89, 4, 3, 2]) results[d] = (await putAtt(X, d)).status;
    expect(results).toEqual({ 91: 200, 90: 409, 89: 409, 4: 409, 3: 409, 2: 200 });
    const pays = {};
    for (const d of [91, 90, 3, 2]) pays[d] = (await postPay(X, { date: D(d), amount: 10 + d })).status;
    expect(pays).toEqual({ 91: 201, 90: 409, 3: 409, 2: 201 });
    const maaps = {};
    const MX = await makeLabour("MAAPVALI", { joiningDate: D(100) });
    for (const d of [91, 90, 3, 2]) maaps[d] = (await putMaap([{ labourId: MX.id, maaps: 4 }], d)).status;
    expect(maaps).toEqual({ 91: 200, 90: 409, 3: 409, 2: 200 });
  });

  it("with no season at all, nothing is guarded", async () => {
    const w = await makeLabour("BIGARI");
    expect((await putAtt(w, 10)).status).toBe(200);
    expect((await postPay(w, { date: D(10) })).status).toBe(201);
  });

  it("an OPEN season never blocks, including the first day after a closed one, and entries in it fence it", async () => {
    const { season } = await closedSeason();
    const closedVersion = db.seasons.get(season.id).writeVersion; // writes made while it was still open
    const next = await makeSeason("Season 2027-28", D(2));
    const w = await makeLabour("BIGARI");
    expect(next.status).toBe("OPEN");
    expect((await putAtt(w, 2)).status).toBe(200);
    expect((await postPay(w, { date: D(1) })).status).toBe(201);
    expect((await putAtt(w, 3)).status).toBe(409); // last day of the closed season
    expect(db.seasons.get(next.id).writeVersion).toBe(2); // each guarded write touched the open season
    expect(db.seasons.get(season.id).writeVersion).toBe(closedVersion); // refused writes never touch the closed one
    const dto = (await asOwner("get", `/api/seasons/${next.id}`)).body.data;
    expect(dto).not.toHaveProperty("writeVersion");
  });

  it("two closed seasons each guard only their own dates", async () => {
    const s1 = await makeSeason("Old season", D(90));
    const w = await makeLabour("BIGARI", { joiningDate: D(100) });
    await markAttendance(w, 80);
    expect((await close((await asOwner("get", `/api/seasons/${s1.id}`)).body.data, { endDate: D(50) })).status).toBe(201);
    const s2 = await makeSeason("Newer season", D(49));
    await markAttendance(w, 40);
    expect((await close((await asOwner("get", `/api/seasons/${s2.id}`)).body.data, { endDate: D(20) })).status).toBe(201);
    expect((await putAtt(w, 70)).status).toBe(409);
    expect((await putAtt(w, 30)).status).toBe(409);
    expect((await putAtt(w, 49)).status).toBe(409);
    expect((await putAtt(w, 50)).status).toBe(409);
    expect((await putAtt(w, 19)).status).toBe(200);
  });
});

describe("the guard is part of the write's transaction", () => {
  const closeBehindOurBack = () => {
    db.beforeSeasonUpdate = (filter) => {
      db.beforeSeasonUpdate = null;
      const row = [...db.seasons.values()].find((r) => String(r._id) === String(filter._id));
      row.status = "CLOSED"; // a close committed between this write's check and its fence
      row.endDate = D(0);
      db.resnapshot();
    };
  };

  it("an attendance day saved while its open season is being closed is refused and rolled back", async () => {
    const season = await makeSeason("Season 2026-27", D(90));
    const w = await makeLabour("BIGARI");
    const before = [...db.attendance.values()].length;
    closeBehindOurBack();
    const res = await putAtt(w, 5);
    expect(res.status, closedBody(res)).toBe(409);
    expect(closedBody(res)).toContain("closed");
    expect([...db.attendance.values()]).toHaveLength(before);
    expect(season.id).toBeTruthy();
  });

  it("the same for a Maapvali day and for a payment", async () => {
    await makeSeason("Season 2026-27", D(90));
    const w = await makeLabour("MAAPVALI");
    closeBehindOurBack();
    expect((await putMaap([{ labourId: w.id, maaps: 4 }], 5)).status).toBe(409);
    expect(db.maap.size).toBe(0);
    for (const row of db.seasons.values()) Object.assign(row, { status: "OPEN", endDate: null });
    closeBehindOurBack();
    const before = db.payments.size;
    expect((await postPay(w, { date: D(5) })).status).toBe(409);
    expect(db.payments.size).toBe(before);
  });

  it("a multi-worker attendance day that fails part-way saves nothing", async () => {
    const [a, b, c] = [await makeLabour("BIGARI"), await makeLabour("BIGARI"), await makeLabour("BIGARI")];
    let calls = 0;
    db.beforeAttendanceUpdate = () => {
      calls += 1;
      if (calls === 2) throw new Error("simulated database fault on the second worker");
    };
    const res = await asOwner("put", `/api/attendance/${D(5)}`, { entries: [a, b, c].map((w) => ({ labourId: w.id, status: "PRESENT" })), reason: "Late entry" });
    db.beforeAttendanceUpdate = null;
    expect(res.status).toBe(500);
    expect(db.attendance.size).toBe(0);
    expect((await asOwner("put", `/api/attendance/${D(5)}`, { entries: [a, b, c].map((w) => ({ labourId: w.id, status: "PRESENT" })), reason: "Late entry" })).status).toBe(200);
    expect(db.attendance.size).toBe(3);
  });
});

describe("existing records are preserved and nothing is reopened", () => {
  it("every refused write leaves attendance, Maapvali, payments, settlement and statements byte-for-byte unchanged", async () => {
    const { A, M, B } = await closedSeason();
    const before = state();
    const seasonBefore = JSON.stringify([...db.seasons.values()]);
    await putAtt(A, 9, "ABSENT");
    await putAtt(B, 20);
    await putMaap([{ labourId: M.id, maaps: 12 }], 8);
    await postPay(A);
    await postPay(B, { type: "BOOKING_ADVANCE", date: D(40) });
    const inside = [...db.payments.values()][0];
    await asOwner("delete", `/api/payments/${inside._id}`, { reason: "Wrong" });
    expect(state()).toBe(before);
    expect(JSON.stringify([...db.seasons.values()])).toBe(seasonBefore); // refused writes do not even touch the season
  });

  it("there is no way to reopen a season: no reopen route, and PATCH still cannot change the status", async () => {
    const { season } = await closedSeason();
    expect((await asOwner("post", `/api/seasons/${season.id}/reopen`, {})).status).toBe(404);
    expect((await asOwner("patch", `/api/seasons/${season.id}`, { status: "OPEN" })).status).toBe(409);
    expect(db.seasons.get(season.id).status).toBe("CLOSED");
  });

  it("reports, the ledger and the settlement keep working on a closed season", async () => {
    const { season, data } = await closedSeason();
    expect((await asOwner("get", "/api/salary")).status).toBe(200);
    expect((await asOwner("get", "/api/payments")).status).toBe(200);
    expect((await asOwner("get", `/api/maap-entries?from=${D(30)}&to=${D(0)}`)).status).toBe(200);
    expect((await view(season)).summary.workers).toBe(data.summary.workers);
  });
});

describe("source checks", () => {
  const code = (f) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8").split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  it("every ordinary write path calls the guard inside a required transaction; the settlement payment route does not use it", () => {
    for (const [file, n] of [["services/attendance.service.js", 1], ["services/maapEntry.service.js", 3], ["services/payment.service.js", 3]]) {
      const c = code(file);
      expect(c.match(/guardWrite\(/g)?.length, file).toBeGreaterThanOrEqual(n);
      expect(c.match(/assertDatesOpen\(/g)?.length, file).toBeGreaterThanOrEqual(n);
      expect(c).toMatch(/\{ required: true \}/);
    }
    expect(code("services/settlementPayment.service.js")).not.toMatch(/writeGuard|guardWrite|assertDatesOpen/);
  });
  it("the guard writes only the open season's writeVersion and never changes status, dates or records", () => {
    const c = code("services/writeGuard.js");
    expect(c.match(/Season\.updateOne\(/g)).toHaveLength(1);
    expect(c).toContain("$inc: { writeVersion: 1 }");
    expect(c).not.toMatch(/\$set|deleteOne|deleteMany|insertMany|\.create\(|process\.env/);
  });
});
