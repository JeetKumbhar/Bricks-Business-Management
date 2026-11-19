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
const { db, makeAttendanceModel, makeCounterModel, makeLabourModel, makeMaapEntryModel, makeProductionEntryModel, makeRateModel, makeSeasonModel } = await import("./helpers/memoryDb.js");
const users = vi.hoisted(() => ({ list: [] }));

vi.mock("../config/db.js", () => ({ getDbStatus: async () => ({ status: "connected", name: "test" }) }));
vi.mock("../models/User.js", () => ({
  default: { findById: (id) => ({ lean: async () => users.list.find((u) => String(u._id) === String(id)) ?? null }) },
}));
vi.mock("../models/Counter.js", () => ({ default: makeCounterModel() }));
vi.mock("../utils/transaction.js", () => ({ runInTransaction: async (work, options) => {
    (globalThis.__txCalls ??= []).push(options);
    // like session.withTransaction: a TransientTransactionError aborts the attempt (rolled back by db.transaction) and re-runs the callback
    for (let attempt = 1; ; attempt += 1) {
      globalThis.__txAttempts = (globalThis.__txAttempts ?? 0) + 1;
      try {
        return await db.transaction(() => work(null));
      } catch (err) {
        if (!(err?.errorLabels ?? []).includes("TransientTransactionError") || attempt >= 3) throw err;
      }
    }
  } }));
vi.mock("../models/Labour.js", async (importOriginal) => ({ default: makeLabourModel((await importOriginal()).default) }));
vi.mock("../models/LabourRateHistory.js", async (importOriginal) => ({ default: makeRateModel((await importOriginal()).default) }));
vi.mock("../models/Attendance.js", () => ({ default: makeAttendanceModel() }));
vi.mock("../models/MaapEntry.js", () => ({ default: makeMaapEntryModel() }));
vi.mock("../models/Season.js", async (importOriginal) => ({ default: makeSeasonModel((await importOriginal()).default) }));
vi.mock("../models/ProductionEntry.js", () => ({ default: makeProductionEntryModel() }));

const { createApp } = await import("../app.js");
const { signAccessToken } = await import("../services/auth.service.js");
const { calculateProduction, payableBricksFor, summarizeProduction } = await import("../services/productionCalculations.js");
const { addDays, todayBusinessDate } = await import("../utils/dates.js");
const { rupeesToPaise } = await import("../utils/money.js");
const RealProductionEntry = (await vi.importActual("../models/ProductionEntry.js")).default;
const RealSeason = (await vi.importActual("../models/Season.js")).default;

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
const team = (o) => makeLabour("PATLAVALE", o);
const makeSeason = async (o = {}) => {
  const res = await asOwner("post", "/api/seasons", { name: "Season 2026-27", startDate: daysAgo(90), ...o });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.data;
};

const save = (date, rows, extra = {}) => asOwner("put", `/api/production-entries/day/${date}`, { rows, ...extra });
const row = (t, maaps, note) => ({ teamId: t.id, maaps, ...(note === undefined ? {} : { note }) });
const liveRows = (date) => [...db.production.values()].filter((r) => r.date === date && !r.isDeleted);
const changeRate = (t, newRate, effectiveFrom) => asOwner("post", `/api/labours/${t.id}/rates`, { newRate, effectiveFrom, reason: "Revised rate" });
const entryFor = async (t, date) => (await asOwner("get", `/api/production-entries?date=${date}`)).body.data.items.find((i) => i.teamId === t.id);
const seasonTotals = async (season) => (await asOwner("get", `/api/seasons/${season.id}/production`)).body.data;

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

// Phase 1C / P6. FAKE-DATABASE tests only: the in-memory store has no snapshot isolation and no WriteConflict. A "rival commit" is simulated
// by a hook that changes the store between the service's read and its write. Real MongoDB transaction behaviour is NOT proven here.
const seasonRow = (id) => db.seasons.get(String(id));
const rivalChangesSeason = (id, change) => {
  db.beforeSeasonUpdate = (filter) => {
    if (String(filter._id) !== String(id)) return;
    db.beforeSeasonUpdate = null;
    const row = seasonRow(id);
    Object.assign(row, change, { revision: row.revision + 1 }); // NOT re-snapshotted: the fake's rollback restores everything, the rival's change included, which keeps the assertions about OUR writes independent of the order the seasons are guarded in
  };
};
const snapshot = () => JSON.stringify([[...db.production.values()], [...db.seasons.values()]]);
const txOptions = () => globalThis.__txCalls;
beforeEach(() => {
  globalThis.__txCalls = [];
  globalThis.__txAttempts = 0;
});

describe("P6: saveDay takes a guarded season write", () => {
  it("bumps the season revision once per save that changes something, not for an unchanged re-send", async () => {
    const s = await makeSeason();
    const t = await team();
    expect(seasonRow(s.id).revision).toBe(1);
    expect((await save(today, [row(t, 4)])).status).toBe(200);
    expect(seasonRow(s.id).revision).toBe(2);
    expect((await save(today, [row(t, 4)])).status).toBe(200); // same numbers: nothing changes
    expect(seasonRow(s.id).revision).toBe(2);
    expect((await save(today, [row(t, 5)])).status).toBe(200);
    expect(seasonRow(s.id).revision).toBe(3);
  });

  it("saves on different days of one season both succeed", async () => {
    const s = await makeSeason();
    const t = await team();
    expect((await save(daysAgo(2), [row(t, 4)], { reason: "Late entry" })).status).toBe(200);
    expect((await save(daysAgo(1), [row(t, 6)], { reason: "Late entry" })).status).toBe(200);
    expect(seasonRow(s.id).revision).toBe(3);
    expect([...db.production.values()]).toHaveLength(2);
  });

  it("is a required transaction", async () => {
    await makeSeason();
    const t = await team();
    await save(today, [row(t, 4)]);
    expect(txOptions().at(-1)).toMatchObject({ required: true });
  });

  it("409 and nothing saved when the season is closed after the service read it", async () => {
    const s = await makeSeason();
    const t = await team();
    rivalChangesSeason(s.id, { status: "CLOSED" });
    const before = snapshot();
    const res = await save(today, [row(t, 4)]);
    expect(res.status).toBe(409);
    expect([...db.production.values()]).toHaveLength(0);
    expect(snapshot()).toBe(before); // everything, the revision included, is back to its state before the request
  });

  it("409 and nothing saved when the season dates move away from the day after the service read it", async () => {
    const s = await makeSeason();
    const t = await team();
    rivalChangesSeason(s.id, { endDate: daysAgo(5) });
    const res = await save(today, [row(t, 4)]);
    expect(res.status).toBe(409);
    expect([...db.production.values()]).toHaveLength(0);
  });

  it("rolls the season revision and every row back together when a later row conflicts", async () => {
    const s = await makeSeason();
    const a = await team();
    const b = await team();
    let calls = 0;
    db.beforeProductionUpdate = () => {
      calls += 1;
      if (calls !== 2) return; // the first row is written, the second loses a race
      db.beforeProductionUpdate = null;
      db.production.set("rival", { _id: "rival", teamId: b.id, seasonId: s.id, date: today, numberOfMaaps: 9, payableBricks: 2250, ratePaise: 65000, earningsPaise: 146250, revision: 1, history: [], isDeleted: false });
      // no resnapshot: the fake restores its pre-transaction snapshot, so an empty store proves row 1 AND the revision bump were undone
    };
    const res = await save(today, [row(a, 4), row(b, 4)]); // today: no reason needed
    expect(res.status).toBe(409);
    expect([...db.production.values()]).toEqual([]); // the first row was rolled back
    expect(seasonRow(s.id).revision).toBe(1); // and so was the revision bump
  });
});

describe("P6: correctEntry takes guarded season writes", () => {
  const entryIn = async (season, t, date, maaps = 4) => {
    expect((await save(date, [row(t, maaps)], { reason: "Late entry" })).status).toBe(200);
    return [...db.production.values()].find((r) => r.teamId === t.id && r.date === date && !r.isDeleted);
  };
  const twoSeasons = async () => {
    const s1 = await makeSeason({ name: "S1", startDate: daysAgo(90), endDate: daysAgo(31) });
    const s2 = await makeSeason({ name: "S2", startDate: daysAgo(30) });
    return [s1, s2];
  };
  const patch = (id, body) => asOwner("patch", `/api/production-entries/${id}`, { reason: "Correction", ...body });

  it("a maaps correction is a required transaction and bumps its season revision", async () => {
    const s = await makeSeason();
    const t = await team();
    const e = await entryIn(s, t, today);
    const rev = seasonRow(s.id).revision;
    expect((await patch(e._id, { newMaaps: 6 })).status).toBe(200);
    expect(seasonRow(s.id).revision).toBe(rev + 1);
    expect(txOptions().at(-1)).toMatchObject({ required: true });
  });

  it("an unchanged correction writes nothing and does not bump the revision", async () => {
    const s = await makeSeason();
    const t = await team();
    const e = await entryIn(s, t, today);
    const rev = seasonRow(s.id).revision;
    expect((await patch(e._id, { newMaaps: 4 })).status).toBe(200);
    expect(seasonRow(s.id).revision).toBe(rev);
  });

  it("409 and the entry unchanged when its season is closed after the service read it", async () => {
    const s = await makeSeason();
    const t = await team();
    const e = await entryIn(s, t, today);
    rivalChangesSeason(s.id, { status: "CLOSED" });
    const res = await patch(e._id, { newMaaps: 9 });
    expect(res.status).toBe(409);
    expect([...db.production.values()][0]).toMatchObject({ numberOfMaaps: 4, revision: e.revision });
  });

  it("a date move across seasons bumps BOTH seasons once and moves the entry", async () => {
    const [s1, s2] = await twoSeasons();
    const t = await team();
    const e = await entryIn(s2, t, daysAgo(10));
    const [r1, r2] = [seasonRow(s1.id).revision, seasonRow(s2.id).revision];
    expect((await patch(e._id, { date: daysAgo(40) })).status).toBe(200);
    expect(seasonRow(s1.id).revision).toBe(r1 + 1);
    expect(seasonRow(s2.id).revision).toBe(r2 + 1);
    expect([...db.production.values()][0]).toMatchObject({ date: daysAgo(40), seasonId: s1.id });
  });

  it("a date move inside one season bumps it once", async () => {
    const s = await makeSeason();
    const t = await team();
    const e = await entryIn(s, t, daysAgo(10));
    const rev = seasonRow(s.id).revision;
    expect((await patch(e._id, { date: daysAgo(12) })).status).toBe(200);
    expect(seasonRow(s.id).revision).toBe(rev + 1);
  });

  it("409 and nothing changed when the TARGET season is closed after the service read it", async () => {
    const [s1, s2] = await twoSeasons();
    const t = await team();
    const e = await entryIn(s2, t, daysAgo(10));
    rivalChangesSeason(s1.id, { status: "CLOSED" });
    const before = JSON.stringify([...db.production.values()]);
    expect((await patch(e._id, { date: daysAgo(40) })).status).toBe(409);
    expect(JSON.stringify([...db.production.values()])).toBe(before);
    expect(seasonRow(s2.id).revision).toBe(2); // the source guard's bump was rolled back with everything else (only the entry's own save counted)
  });

  it("409 and nothing changed when the SOURCE season is closed after the service read it", async () => {
    const [s1, s2] = await twoSeasons();
    const t = await team();
    const e = await entryIn(s2, t, daysAgo(10));
    rivalChangesSeason(s2.id, { status: "CLOSED" });
    const before = JSON.stringify([...db.production.values()]);
    expect((await patch(e._id, { date: daysAgo(40) })).status).toBe(409);
    expect(JSON.stringify([...db.production.values()])).toBe(before);
    expect(seasonRow(s1.id).revision).toBe(1);
  });

  it("the target season's dates moving away after the read also give 409", async () => {
    const [s1, s2] = await twoSeasons();
    const t = await team();
    const e = await entryIn(s2, t, daysAgo(10));
    rivalChangesSeason(s1.id, { endDate: daysAgo(50) });
    expect((await patch(e._id, { date: daysAgo(40) })).status).toBe(409);
  });
});

describe("P6: deleteEntry takes a guarded season write", () => {
  const remove = (id) => asOwner("delete", `/api/production-entries/${id}`, { reason: "Wrong team" });
  it("deletes inside a required transaction and bumps the season revision", async () => {
    const s = await makeSeason();
    const t = await team();
    await save(today, [row(t, 4)]);
    const e = [...db.production.values()][0];
    const rev = seasonRow(s.id).revision;
    expect((await remove(e._id)).status).toBe(200);
    expect(e.isDeleted).toBe(true);
    expect(seasonRow(s.id).revision).toBe(rev + 1);
    expect(txOptions().at(-1)).toMatchObject({ required: true });
  });
  it("409 and the entry stays live when the season is closed after the service read it", async () => {
    const s = await makeSeason();
    const t = await team();
    await save(today, [row(t, 4)]);
    const e = [...db.production.values()][0];
    rivalChangesSeason(s.id, { status: "CLOSED" });
    expect((await remove(e._id)).status).toBe(409);
    expect(e.isDeleted).toBe(false);
  });
});

describe("P6: deleteEntry never acts on a stale entry (revision, season and date are part of the delete's filter)", () => {
  const remove = (id) => asOwner("delete", `/api/production-entries/${id}`, { reason: "Wrong team" });
  const setup = async () => {
    const s1 = await makeSeason({ name: "S1", startDate: daysAgo(90), endDate: daysAgo(31) });
    const s2 = await makeSeason({ name: "S2", startDate: daysAgo(30) });
    const t = await team();
    expect((await save(daysAgo(10), [row(t, 4)], { reason: "Late entry" })).status).toBe(200);
    const e = [...db.production.values()][0];
    return { s1, s2, t, e };
  };
  // A rival correction commits just before OUR guard runs: the entry moves to season S1 (new date, revision + 1). The snapshot is taken
  // here, so our own later writes (the guard bump) are rolled back but the rival's commit survives, as it would on a real server.
  const rivalMovesEntry = (e, s1, { transient = false } = {}) => {
    let fired = false;
    db.beforeSeasonUpdate = () => {
      if (fired) return;
      fired = true;
      Object.assign(e, { seasonId: s1.id, date: daysAgo(40), revision: e.revision + 1 });
      db.resnapshot();
      if (transient) throw Object.assign(new Error("WriteConflict"), { code: 112, errorLabels: ["TransientTransactionError"] });
    };
  };

  it("a rival correction that moved the entry to another season: 409, entry still live in its NEW season, no season revision bumped", async () => {
    const { s1, s2, e } = await setup();
    const [r1, r2] = [seasonRow(s1.id).revision, seasonRow(s2.id).revision];
    rivalMovesEntry(e, s1);
    const res = await remove(e._id);
    expect(res.status).toBe(409);
    expect(e).toMatchObject({ isDeleted: false, seasonId: s1.id, date: daysAgo(40) }); // the rival's move is intact, nothing was deleted
    expect(seasonRow(s1.id).revision).toBe(r1);
    expect(seasonRow(s2.id).revision).toBe(r2); // our guard bump on the OLD season was rolled back
  });

  it("the RETRY after a transient conflict must not delete through the stale season: still 409, entry live in the new season", async () => {
    const { s1, s2, e } = await setup();
    const [r1, r2] = [seasonRow(s1.id).revision, seasonRow(s2.id).revision];
    globalThis.__txAttempts = 0; // count only the delete's attempts, not the setup save
    rivalMovesEntry(e, s1, { transient: true });
    const res = await remove(e._id);
    expect(globalThis.__txAttempts).toBe(2); // first attempt aborted by the transient error, the callback was re-run with the same (stale) read
    expect(res.status).toBe(409);
    expect(e).toMatchObject({ isDeleted: false, seasonId: s1.id, date: daysAgo(40) });
    expect(seasonRow(s1.id).revision).toBe(r1);
    expect(seasonRow(s2.id).revision).toBe(r2);
  });

  it("a stale revision (rival edited the maaps): 409, entry live and unchanged, no season bump", async () => {
    const { s2, e } = await setup();
    const rev = seasonRow(s2.id).revision;
    db.beforeSeasonUpdate = () => { // before OUR guard, so the snapshot holds the rival's commit but not our bump
      db.beforeSeasonUpdate = null;
      Object.assign(e, { numberOfMaaps: 8, revision: e.revision + 1 });
      db.resnapshot();
    };
    expect((await remove(e._id)).status).toBe(409);
    expect(e).toMatchObject({ isDeleted: false, numberOfMaaps: 8 });
    expect(seasonRow(s2.id).revision).toBe(rev); // the guard bump rolled back
  });

  it("a rival that changed only the date inside the same season is also detected", async () => {
    const { s2, e } = await setup();
    const rev = seasonRow(s2.id).revision;
    db.beforeSeasonUpdate = () => {
      db.beforeSeasonUpdate = null;
      Object.assign(e, { date: daysAgo(12), revision: e.revision + 1 });
      db.resnapshot();
    };
    expect((await remove(e._id)).status).toBe(409);
    expect(e).toMatchObject({ isDeleted: false, date: daysAgo(12) });
    expect(seasonRow(s2.id).revision).toBe(rev);
  });

  it("with no rival the delete still succeeds and bumps only the entry's own season once", async () => {
    const { s1, s2, e } = await setup();
    const [r1, r2] = [seasonRow(s1.id).revision, seasonRow(s2.id).revision];
    expect((await remove(e._id)).status).toBe(200);
    expect(e.isDeleted).toBe(true);
    expect(seasonRow(s2.id).revision).toBe(r2 + 1);
    expect(seasonRow(s1.id).revision).toBe(r1);
  });
});

describe("P6: updateSeason with a stale revision", () => {
  it("returns 409 and changes nothing when a production save committed after it read the season", async () => {
    const s = await makeSeason();
    const t = await team();
    await save(daysAgo(60), [row(t, 4)]);
    // updateSeason reads the season, finds no stranded entry for the new dates, then a production save commits (revision bump) before the write
    db.beforeSeasonUpdate = (filter) => {
      if (filter.revision === undefined) return;
      db.beforeSeasonUpdate = null;
      seasonRow(s.id).revision += 1;
      db.production.set("late", { _id: "late", teamId: t.id, seasonId: s.id, date: daysAgo(80), numberOfMaaps: 4, payableBricks: 1000, ratePaise: 65000, earningsPaise: 65000, revision: 1, history: [], isDeleted: false });
    };
    const res = await asOwner("patch", `/api/seasons/${s.id}`, { startDate: daysAgo(70) });
    expect(res.status).toBe(409);
    expect(seasonRow(s.id).startDate).toBe(daysAgo(90)); // dates NOT moved, so the late entry is not stranded
  });
  it("a season edit that is not stale still works", async () => {
    const s = await makeSeason();
    expect((await asOwner("patch", `/api/seasons/${s.id}`, { name: "Renamed" })).status).toBe(200);
  });
});
