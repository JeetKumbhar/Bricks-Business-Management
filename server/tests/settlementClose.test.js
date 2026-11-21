// FAKE-DATABASE tests for the season CLOSE operation and permanent settlement snapshots (S2). No MongoDB, no network, no .env.
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
const settle = vi.hoisted(() => ({ settlements: new Map(), statements: new Map(), decisions: new Map(), locks: new Map(), queue: Promise.resolve(), failStatementAt: null }));
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
vi.mock("../models/SettlementLock.js", () => ({ default: {} }));
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
  settle.failStatementAt = null;
  settle.queue = Promise.resolve();
  users.list.length = 0;
  mobileSeq = 0;
  owner = addUser("OWNER");
  manager = addUser("MANAGER", "Helper");
  app = createApp();
});
afterEach(() => vi.useRealTimers());

describe("closing a season saves a permanent statement for every included worker", () => {
  it("creates one settlement and one statement per worker with every figure, in one step, and closes the season", async () => {
    const { season, bigari, maapvali, patlavale } = await fixture();
    const res = await close(season);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const { settlement, statements } = res.body.data;
    expect(settlement).toMatchObject({ seasonId: season.id, seasonName: "Season 2026-27", startDate: D(90), endDate: today, ledgerDate: today, schemaVersion: 1, seasonRevisionBefore: season.revision });
    expect(settlement.closedBy).toMatchObject({ name: "Ramesh Patel" });
    expect(settlement.totals).toMatchObject({ workers: 3, payableWorkers: 3, recoverableWorkers: 0, zeroWorkers: 0, earned: 6037.5, received: 3000, payable: 3037.5, recoverable: 0, earnedPaise: 603_750, payablePaise: 303_750 });
    expect(settlement.policy).toMatchObject({ bayanaCountsAsReceived: true });
    expect(statements).toHaveLength(3);
    const by = (w) => statements.find((s) => s.labourId === w.id);
    expect(by(bigari)).toMatchObject({ labourType: "BIGARI", name: bigari.name, status: "PAYABLE", openingPaise: 0, earnedPaise: 267_500, bayanaPaise: 100_000, salaryPaise: 130_000, receivedPaise: 230_000, closingPaise: 37_500, payablePaise: 37_500, recoverablePaise: 0, closing: 375, resolution: { kind: "SETTLE_BY_PAYMENT", amountPaise: 37_500 } });
    expect(by(maapvali)).toMatchObject({ labourType: "MAAPVALI", earnedPaise: 130_000, receivedPaise: 20_000, closingPaise: 110_000, status: "PAYABLE" });
    expect(by(patlavale)).toMatchObject({ labourType: "PATLAVALE", earnedPaise: 206_250, receivedPaise: 50_000, closingPaise: 156_250, status: "PAYABLE" });
    expect(by(maapvali).work).toMatchObject({ maaps: 20, workDays: 3 });
    expect(by(patlavale).work).toMatchObject({ maaps: 12, payableBricks: 3000 });
    // The season is closed through this operation, with the confirmed end date.
    expect(seasonRow(season.id)).toMatchObject({ status: "CLOSED", endDate: today, revision: season.revision + 1 });
    // The stored record is the same one the API returns afterwards.
    const stored = (await getSettlement(season)).body.data; // S3 adds derived progress beside the same settlement and statements
    expect({ settlement: stored.settlement, statements: stored.statements }).toEqual(JSON.parse(JSON.stringify(res.body.data)));
  });

  it("keeps the source lines behind each figure, each pointing at the real attendance / Maapvali / production / payment record", async () => {
    const { season, bigari, maapvali, patlavale } = await fixture();
    const { statements } = (await close(season)).body.data;
    const known = new Set([db.attendance, db.maap, db.production, db.payments].flatMap((m) => [...m.values()].map((r) => String(r._id))));
    for (const s of statements) {
      expect(s.lines.length).toBe(s.workLines + s.paymentLines);
      expect(s.lines.length).toBeGreaterThan(0);
      expect(s.lines.reduce((t, l) => t + (l.earnedPaise ?? 0), 0), s.name).toBe(s.earnedPaise);
      expect(s.lines.reduce((t, l) => t + (l.receivedPaise ?? 0), 0), s.name).toBe(s.receivedPaise);
      for (const l of s.lines) {
        expect(l.sourceId, JSON.stringify(l)).toBeTruthy();
        expect(known.has(String(l.sourceId)), `${s.name}: source ${l.sourceId} must exist`).toBe(true);
      }
    }
    expect(statements.find((s) => s.labourId === bigari.id).workLines).toBe(5);
    expect(statements.find((s) => s.labourId === maapvali.id).workLines).toBe(3);
    expect(statements.find((s) => s.labourId === patlavale.id).paymentLines).toBe(1);
  });

  it("matches the preview exactly, worker by worker", async () => {
    const { season } = await fixture();
    const shown = (await preview(season.id)).body.data;
    const { statements } = (await close(season)).body.data;
    for (const item of shown.items) {
      const s = statements.find((x) => x.labourId === item.labourId);
      expect([s.opening, s.earned, s.received, s.closing, s.payable, s.recoverable, s.status]).toEqual([item.opening, item.earned, item.received, item.closing, item.payable, item.recoverable, item.status]);
    }
  });

  it("a negative balance is stored as RECOVERABLE and needing the Owner's carry-forward decision: not settled, zeroed or written off", async () => {
    const { season } = await fixture();
    const w = await makeLabour("BIGARI");
    await pay(w, { type: "BOOKING_ADVANCE", amount: 400, date: D(20) });
    const { settlement, statements } = (await close(season)).body.data;
    const s = statements.find((x) => x.labourId === w.id);
    expect(s).toMatchObject({ status: "RECOVERABLE", closingPaise: -40_000, payablePaise: 0, recoverablePaise: 40_000 });
    expect(s.resolution).toEqual({ kind: "CARRY_FORWARD_AS_OPENING_ADVANCE", amountPaise: 40_000, requiresExplicitDecision: true, amount: 400 });
    expect(settlement.totals).toMatchObject({ recoverableWorkers: 1, recoverablePaise: 40_000 });
    expect(settlement.totals.payablePaise).toBe(303_750); // a negative balance never reduces what others are owed
    // Nothing was recorded for them: the advance is still just the same single payment.
    expect([...db.payments.values()].filter((p) => p.recipientId === w.id)).toHaveLength(1);
  });

  it("zero-earning workers get a ZERO statement; inactive workers are kept only when they have a record or balance", async () => {
    const { season, maapvali } = await fixture();
    const idle = await makeLabour("BIGARI");
    const gone = await makeLabour("BIGARI");
    db.labours.get(maapvali.id).status = "INACTIVE";
    db.labours.get(gone.id).status = "INACTIVE";
    const { settlement, statements } = (await close(season)).body.data;
    expect(statements.find((s) => s.labourId === idle.id)).toMatchObject({ status: "ZERO", closingPaise: 0, resolution: { kind: "NONE" }, lines: [] });
    expect(statements.find((s) => s.labourId === maapvali.id)).toMatchObject({ labourStatus: "INACTIVE", closingPaise: 110_000 });
    expect(statements.find((s) => s.labourId === gone.id)).toBeUndefined();
    expect(settlement.notIncluded).toBe(1);
  });

  it("records NO worker payment and leaves every attendance, production, payment, rate and labour record untouched", async () => {
    const { season } = await fixture();
    const before = sources();
    const paymentCount = db.payments.size;
    expect((await close(season)).status).toBe(201);
    expect(sources()).toBe(before);
    expect(db.payments.size).toBe(paymentCount);
    // Only the season changed, and only status / end date / revision / who and when.
    const row = seasonRow(season.id);
    expect(row).toMatchObject({ name: "Season 2026-27", startDate: D(90), status: "CLOSED" });
  });
});

describe("what blocks a close (nothing is saved, the season stays OPEN)", () => {
  const untouched = (season) => {
    expect(settle.settlements.size).toBe(0);
    expect(settle.statements.size).toBe(0);
    expect(seasonRow(season.id)).toMatchObject({ status: "OPEN", endDate: season.endDate ?? null, revision: season.revision });
  };

  it("Bigari days with no rate", async () => {
    const { season } = await fixture();
    const w = await makeLabour("BIGARI");
    await markAttendance(w, 5);
    dropRates(w);
    const res = await close(season);
    expect(res.status).toBe(409);
    expect(JSON.stringify(res.body)).toContain("MISSING_RATE");
    untouched(season);
  });
  it("a next season that does not start the day after the end date", async () => {
    const a = await makeSeason("Season A", D(90), D(31));
    await makeSeason("Season B", D(20));
    const res = await close(a, { endDate: D(31) });
    expect(res.status).toBe(409);
    expect(JSON.stringify(res.body)).toContain("NEXT_SEASON_START");
    untouched(a);
  });
  it("closes when the next season starts exactly the day after", async () => {
    const a = await makeSeason("Season A", D(90), D(31));
    await makeSeason("Season B", D(30));
    expect((await close(a, { endDate: D(31) })).status).toBe(201);
  });
  it("a future end date, and an end date before the start", async () => {
    const { season } = await fixture();
    expect((await close(season, { endDate: addDays(today, 2) })).status).toBe(409);
    expect((await close(season, { endDate: D(91) })).status).toBe(409);
    untouched(season);
  });
  it("production dated after the chosen end date (it would be left outside its own season)", async () => {
    const { season } = await fixture();
    const res = await close(season, { endDate: D(5) }); // production exists on D(2) and today
    expect(res.status).toBe(409);
    expect(JSON.stringify(res.body)).toContain("production entr");
    untouched(season);
  });
  it("an already closed season cannot be closed again, and a stale revision is refused", async () => {
    const { season } = await fixture();
    expect((await close(season, { revision: season.revision + 5 })).status).toBe(409);
    untouched(season);
    expect((await close(season)).status).toBe(201);
    const again = await close(season);
    expect(again.status).toBe(409);
    expect(settle.settlements.size).toBe(1);
  });
});

describe("input and access", () => {
  it("needs an Owner, a known season, and a strict body", async () => {
    const { season } = await fixture();
    const body = { endDate: today, revision: season.revision };
    expect((await send("post", `/api/seasons/${season.id}/close`, null, body)).status).toBe(401);
    expect((await send("post", `/api/seasons/${season.id}/close`, manager.cookie, body)).status).toBe(403);
    expect((await asOwner("post", "/api/seasons/0123456789abcdef01234567/close", body)).status).toBe(404);
    expect((await asOwner("post", "/api/seasons/bad/close", body)).status).toBe(400);
    for (const bad of [{ revision: season.revision }, { endDate: today }, { ...body, extra: 1 }, { ...body, revision: "2" }, { ...body, revision: 0 }, { ...body, endDate: "2026-13-40" }, {}]) {
      expect((await asOwner("post", `/api/seasons/${season.id}/close`, bad)).status, JSON.stringify(bad)).toBe(400);
    }
    expect(settle.settlements.size).toBe(0);
  });
  it("GET settlement is 404 until the season is closed, and 403 for a manager", async () => {
    const { season } = await fixture();
    expect((await getSettlement(season)).status).toBe(404);
    await close(season);
    expect((await send("get", `/api/seasons/${season.id}/settlement`, manager.cookie)).status).toBe(403);
    expect((await getSettlement(season)).status).toBe(200);
  });
});

describe("concurrency, revision guard and one settlement per season", () => {
  it("two closes at the same moment: exactly one succeeds, the other gets a conflict, and there is one settlement", async () => {
    const { season } = await fixture();
    const [a, b] = await Promise.all([close(season), close(season)]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expect(settle.settlements.size).toBe(1);
    expect(settle.statements.size).toBe(3);
    expect(seasonRow(season.id)).toMatchObject({ status: "CLOSED", revision: season.revision + 1 }); // closed once
  });
  it("a production save after the preview changes the revision, so a close with the previewed revision is refused until previewed again", async () => {
    const { season, patlavale } = await fixture();
    expect((await asOwner("put", `/api/production-entries/day/${D(4)}`, { rows: [{ teamId: patlavale.id, maaps: 2 }], reason: "Late entry" })).status).toBe(200);
    expect(seasonRow(season.id).revision).toBeGreaterThan(season.revision);
    const stale = await close(season);
    expect(stale.status).toBe(409);
    expect(settle.settlements.size).toBe(0);
    const fresh = (await asOwner("get", `/api/seasons/${season.id}`)).body.data;
    expect((await close(fresh)).status).toBe(201);
  });
  it("a rival change that commits between the read and the guarded write makes the close fail with nothing saved", async () => {
    const { season } = await fixture();
    db.beforeSeasonUpdate = () => {
      db.beforeSeasonUpdate = null;
      db.seasons.get(season.id).revision += 1; // someone else's committed change
      db.resnapshot?.();
    };
    const res = await close(season);
    expect(res.status).toBe(409);
    expect(settle.settlements.size).toBe(0);
    expect(settle.statements.size).toBe(0);
    expect(seasonRow(season.id).status).toBe("OPEN");
    db.beforeSeasonUpdate = null;
  });
  it("the database refuses a second settlement or a second statement for the same season (unique indexes), and they are declared on the real schemas", async () => {
    const { default: Settlement } = await import("../models/SeasonSettlement.js");
    const { default: Statement } = await import("../models/SettlementStatement.js");
    const { season } = await fixture();
    await close(season);
    const one = [...settle.settlements.values()][0];
    const { _id, createdAt, updatedAt, ...copy } = one;
    await expect(Settlement.insertMany([copy])).rejects.toMatchObject({ code: 11000 });
    const st = [...settle.statements.values()][0];
    const { _id: _s, createdAt: _c, updatedAt: _u, ...stCopy } = st;
    await expect(Statement.insertMany([stCopy])).rejects.toMatchObject({ code: 11000 });
    const real = await vi.importActual("../models/SeasonSettlement.js");
    const realStatement = await vi.importActual("../models/SettlementStatement.js");
    expect(real.default.schema.indexes().some(([k, o]) => k.seasonId === 1 && Object.keys(k).length === 1 && o.unique === true)).toBe(true);
    expect(realStatement.default.schema.indexes().some(([k, o]) => k.seasonId === 1 && k.labourId === 1 && o.unique === true)).toBe(true);
  });
  it("even if a season were forced back to OPEN, an existing settlement stops a second close", async () => {
    const { season } = await fixture();
    expect((await close(season)).status).toBe(201);
    db.seasons.get(season.id).status = "OPEN";
    const reopened = (await asOwner("get", `/api/seasons/${season.id}`)).body.data;
    const res = await close(reopened);
    expect(res.status).toBe(409);
    expect(settle.settlements.size).toBe(1);
    expect(settle.statements.size).toBe(3);
  });
});

describe("transaction: all or nothing", () => {
  it("a database fault while saving statements rolls back the settlement AND the season change; a retry then succeeds exactly once", async () => {
    const { season } = await fixture();
    const before = sources();
    settle.failStatementAt = 1;
    const failed = await close(season);
    expect(failed.status).toBe(500);
    expect(settle.settlements.size).toBe(0);
    expect(settle.statements.size).toBe(0);
    expect(seasonRow(season.id)).toMatchObject({ status: "OPEN", revision: season.revision, endDate: null });
    expect(sources()).toBe(before);
    settle.failStatementAt = null;
    expect((await close(season)).status).toBe(201);
    expect(settle.settlements.size).toBe(1);
    expect(settle.statements.size).toBe(3);
  });
  it("runs inside a REQUIRED transaction", () => {
    const code = readFileSync(new URL("../services/settlement.service.js", import.meta.url), "utf8");
    expect(code).toMatch(/runInTransaction\(\s*async \(session\) =>[\s\S]*\{ required: true \}/);
  });
});

describe("snapshots are immutable and permanent", () => {
  it("every update, replace, delete and re-save of a settlement or statement is refused by the schema", async () => {
    for (const file of ["SeasonSettlement", "SettlementStatement"]) {
      const { default: Real, refuseChanges, IMMUTABLE_MESSAGE } = await vi.importActual(`../models/${file}.js`).then(async (m) => ({ ...m, ...(await vi.importActual("../models/SeasonSettlement.js")) , default: m.default }));
      for (const op of ["updateOne", "updateMany", "findOneAndUpdate", "findOneAndReplace", "replaceOne", "findOneAndDelete", "deleteOne", "deleteMany", "bulkWrite"]) {
        const hooks = Real.schema.s.hooks._pres.get(op) ?? [];
        expect(hooks.some((h) => h.fn === refuseChanges), `${file}.${op}`).toBe(true);
      }
      expect(() => refuseChanges()).toThrow(IMMUTABLE_MESSAGE);
      await expect(Real.updateOne({ seasonId: "x" }, { $set: { seasonName: "changed" } }).exec()).rejects.toMatchObject({ code: "IMMUTABLE_RECORD" });
      await expect(Real.deleteMany({}).exec()).rejects.toMatchObject({ code: "IMMUTABLE_RECORD" });
      await expect(Real.findOneAndUpdate({}, { $set: {} }).exec()).rejects.toMatchObject({ code: "IMMUTABLE_RECORD" });
      const stored = Real.hydrate({ _id: new mongoose.Types.ObjectId() });
      expect(stored.isNew).toBe(false);
      await expect(stored.save({ validateBeforeSave: false })).rejects.toMatchObject({ code: "IMMUTABLE_RECORD" });
      await expect(stored.deleteOne()).rejects.toMatchObject({ code: "IMMUTABLE_RECORD" });
    }
  });
  it("every financial field is declared immutable on the schemas", async () => {
    const settlement = (await vi.importActual("../models/SeasonSettlement.js")).default.schema;
    const statement = (await vi.importActual("../models/SettlementStatement.js")).default.schema;
    for (const path of ["seasonId", "endDate", "ledgerDate", "closedAt", "totals", "policy"]) expect(settlement.path(path).options.immutable, path).toBe(true);
    for (const path of ["openingPaise", "earnedPaise", "receivedPaise", "closingPaise", "payablePaise", "recoverablePaise", "lines", "resolution", "labourId", "status"]) expect(statement.path(path).options.immutable, path).toBe(true);
  });
  it("no HTTP route can change or delete a settlement", async () => {
    const { season } = await fixture();
    await close(season);
    for (const url of [`/api/seasons/${season.id}/settlement`, `/api/seasons/${season.id}/close`]) {
      for (const method of ["put", "patch", "delete"]) expect((await asOwner(method, url, {})).status, `${method} ${url}`).toBe(404);
    }
  });
  it("later changes to work, rates or payments do not alter the saved statements (a snapshot, not a live view)", async () => {
    const { season, bigari } = await fixture();
    await close(season);
    const saved = JSON.stringify((await getSettlement(season)).body.data);
    // S4: ordinary entries inside the closed season are refused; only a rate change (not a work or payment record) is still possible
    expect((await asOwner("put", `/api/attendance/${D(15)}`, { entries: [{ labourId: bigari.id, status: "PRESENT" }], reason: "Late entry" })).status).toBe(409);
    expect((await asOwner("post", "/api/payments", { recipientId: bigari.id, type: "SALARY_PAYMENT", amount: 50, date: D(0) })).status).toBe(409);
    expect((await changeRate(bigari, 900, D(2))).status).toBe(201);
    expect(JSON.stringify((await getSettlement(season)).body.data)).toBe(saved);
  });
});

describe("closing cannot be done (or undone) through the existing PATCH", () => {
  it("PATCH can no longer set CLOSED or reopen, and nothing changes", async () => {
    const { season } = await fixture();
    const open = await asOwner("patch", `/api/seasons/${season.id}`, { status: "CLOSED" });
    expect(open.status).toBe(409);
    expect(JSON.stringify(open.body)).toContain("closing");
    expect(seasonRow(season.id)).toMatchObject({ status: "OPEN", revision: season.revision });
    const closed = await close(season);
    expect(closed.status).toBe(201);
    const row = JSON.stringify(seasonRow(season.id));
    const reopen = await asOwner("patch", `/api/seasons/${season.id}`, { status: "OPEN" });
    expect(reopen.status).toBe(409);
    expect(JSON.stringify(seasonRow(season.id))).toBe(row);
    expect(settle.settlements.size).toBe(1);
  });
  it("a closed season's dates still cannot be edited, while ordinary edits on an open season still work", async () => {
    const { season } = await fixture();
    expect((await asOwner("patch", `/api/seasons/${season.id}`, { status: "OPEN" })).status).toBe(200); // same status: not a change
    expect((await asOwner("patch", `/api/seasons/${season.id}`, { name: "Season 2026-27 (main)" })).status).toBe(200);
    await close((await asOwner("get", `/api/seasons/${season.id}`)).body.data);
    expect((await asOwner("patch", `/api/seasons/${season.id}`, { endDate: D(1) })).status).toBe(409);
  });
  it("production is still refused in a closed season (existing rule)", async () => {
    const { season, patlavale } = await fixture();
    await close(season);
    const res = await asOwner("put", `/api/production-entries/day/${D(0)}`, { rows: [{ teamId: patlavale.id, maaps: 9 }], reason: "Late entry" });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
  it("the internal service function keeps its old behaviour (the test-database harnesses rely on it); only the API is restricted", async () => {
    const { season } = await fixture();
    const svc = await import("../services/season.service.js");
    const updated = await svc.updateSeason(season.id, { status: "CLOSED" }, owner.user);
    expect(updated.status).toBe("CLOSED");
  });
});

describe("source checks", () => {
  const code = readFileSync(new URL("../services/settlement.service.js", import.meta.url), "utf8").split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  it("the close writes only the season guard and the two new collections", () => {
    expect(code).not.toMatch(/\b(Attendance|MaapEntry|Payment|ProductionEntry|Labour|LabourRateHistory)\.(create|insertMany|insertOne|updateOne|updateMany|deleteOne|deleteMany|bulkWrite|findOneAndUpdate|save)\(/);
    expect(code.match(/Season\.updateOne\(/g)).toHaveLength(1);
    expect(code).not.toMatch(/createPayment|payment\.service|Payment/);
  });
  it("PATCH goes through the restricted path", () => {
    expect(readFileSync(new URL("../controllers/season.controller.js", import.meta.url), "utf8")).toContain("forbidStatusChange: true");
  });
  it("the two new models are registered for index synchronisation (not run)", () => {
    const sync = readFileSync(new URL("../scripts/syncIndexes.js", import.meta.url), "utf8");
    expect(sync).toContain("models/SeasonSettlement.js");
    expect(sync).toContain("models/SettlementStatement.js");
  });
});
