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

// ---------------------------------------------------------------------------
describe("access", () => {
  it("needs a login for every production and season route", async () => {
    const id = "aaaaaaaaaaaaaaaaaaaaaaaa";
    for (const [method, url] of [
      ["get", `/api/production-entries?date=${today}`],
      ["put", `/api/production-entries/day/${today}`],
      ["get", `/api/production-entries/${id}`],
      ["patch", `/api/production-entries/${id}`],
      ["delete", `/api/production-entries/${id}`],
      ["get", "/api/labours/L-001/production-entries"],
      ["get", "/api/seasons"],
      ["post", "/api/seasons"],
      ["get", `/api/seasons/${id}`],
      ["patch", `/api/seasons/${id}`],
      ["get", `/api/seasons/${id}/production`],
    ]) {
      expect((await send(method, url, null, method === "get" ? undefined : {})).status, `${method} ${url}`).toBe(401);
    }
  });

  it("lets a non-owner read but not save, correct, delete or manage seasons", async () => {
    const season = await makeSeason();
    const t = await team();
    await save(today, [row(t, 5)]);
    const entry = await entryFor(t, today);
    expect((await send("get", `/api/production-entries?date=${today}`, manager.cookie)).status).toBe(200);
    expect((await send("get", "/api/seasons", manager.cookie)).status).toBe(200);
    expect((await send("get", `/api/seasons/${season.id}/production`, manager.cookie)).status).toBe(200);
    expect((await send("put", `/api/production-entries/day/${today}`, manager.cookie, { rows: [row(t, 6)] })).status).toBe(403);
    expect((await send("patch", `/api/production-entries/${entry.id}`, manager.cookie, { newMaaps: 3, reason: "Fix it" })).status).toBe(403);
    expect((await send("delete", `/api/production-entries/${entry.id}`, manager.cookie, { reason: "Wrong day" })).status).toBe(403);
    expect((await send("post", "/api/seasons", manager.cookie, { name: "X Season", startDate: "2020-01-01" })).status).toBe(403);
    expect((await send("patch", `/api/seasons/${season.id}`, manager.cookie, { status: "CLOSED" })).status).toBe(403);
    expect(liveRows(today)[0].numberOfMaaps).toBe(5);
  });
});

// ---------------------------------------------------------------------------
describe("the formula: every maap is 250 payable bricks", () => {
  it.each([
    [0, 0],
    [1, 250],
    [2, 500],
    [3, 750],
    [4, 1000],
    [5, 1250],
    [7, 1750],
    [9, 2250],
    [41, 10250],
    [9999, 2499750],
  ])("%i maaps = %i payable bricks (no floor, no remainder)", (maaps, bricks) => {
    expect(payableBricksFor(maaps)).toBe(bricks);
    expect(calculateProduction(maaps, 65000).payableBricks).toBe(bricks);
  });

  it("physical bricks are maaps x 275 and information only", () => {
    expect(calculateProduction(4, 65000).physicalBricks).toBe(1100);
    expect(calculateProduction(5, 65000).payableBricks).toBe(1250);
  });

  it("earnings = maaps / 4 x rate per 4 maaps, rounded half up once", () => {
    expect(calculateProduction(1, 65000).earningsPaise).toBe(16250); // 162.50
    expect(calculateProduction(4, 65000).earningsPaise).toBe(65000);
    expect(calculateProduction(7, 65000).earningsPaise).toBe(113750); // 1,137.50
    expect(calculateProduction(1, 8850).earningsPaise).toBe(2213); // 22.125 -> 22.13
  });

  it("rejects maaps that are not whole numbers from 0 to 9999", () => {
    for (const bad of [-1, 1.5, 10000, "3", null, NaN]) expect(() => payableBricksFor(bad), String(bad)).toThrow(RangeError);
    expect(() => calculateProduction(3, 0.5)).toThrow();
  });

  it("saves payable bricks, physical bricks and earnings through the API", async () => {
    await makeSeason();
    const t = await team();
    for (const [maaps, payable] of [[1, 250], [3, 750], [4, 1000], [5, 1250], [7, 1750]]) {
      const date = daysAgo(maaps);
      expect((await save(date, [row(t, maaps)], { reason: "Late entry" })).status, String(maaps)).toBe(200);
      const e = await entryFor(t, date);
      expect(e).toMatchObject({ newMaaps: maaps, newPayableBricks: payable, newPhysicalBricks: maaps * 275, ratePer1000PayableBricks: 650 });
      expect(e.newEarnings).toBe((maaps * 650) / 4);
    }
  });

  it("the client cannot send bricks, a rate, earnings or a season", async () => {
    await makeSeason();
    const t = await team();
    for (const extra of [{ payableBricks: 9 }, { ratePer1000PayableBricks: 1 }, { earnings: 5 }, { seasonId: "aaaaaaaaaaaaaaaaaaaaaaaa" }]) {
      expect((await save(today, [{ ...row(t, 5), ...extra }])).status, JSON.stringify(extra)).toBe(400);
    }
    expect(db.production.size).toBe(0);
  });

  it("rejects maaps that are text, fractional, negative or too large", async () => {
    await makeSeason();
    const t = await team();
    for (const maaps of ["5", 5.5, -1, 10000, null]) expect((await save(today, [row(t, maaps)])).status, String(maaps)).toBe(400);
    expect(db.production.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
describe("seasons", () => {
  it("lets the owner create, list and read seasons", async () => {
    const s = await makeSeason({ name: "Season 2026-27", startDate: "2026-10-01", endDate: "2027-05-31" });
    expect(s).toMatchObject({ name: "Season 2026-27", startDate: "2026-10-01", endDate: "2027-05-31", status: "OPEN" });
    expect((await asOwner("get", "/api/seasons")).body.data).toHaveLength(1);
    expect((await asOwner("get", `/api/seasons/${s.id}`)).body.data.id).toBe(s.id);
    expect((await asOwner("get", "/api/seasons/aaaaaaaaaaaaaaaaaaaaaaaa")).status).toBe(404);
  });

  it("accepts an open-ended season and rejects bad shapes", async () => {
    expect((await makeSeason()).endDate).toBeNull();
    for (const body of [{ name: "A", startDate: "2020-01-01" }, { name: "Good name", startDate: "2020-02-30" }, { name: "Good name", startDate: "2020-05-01", endDate: "2020-04-01" }, { name: "Good name", startDate: "2020-01-01", status: "CLOSED" }]) {
      expect((await asOwner("post", "/api/seasons", body)).status, JSON.stringify(body)).toBe(400);
    }
  });

  it("refuses overlapping seasons and duplicate names, but allows back-to-back ones", async () => {
    await makeSeason({ name: "Season A", startDate: "2025-10-01", endDate: "2026-05-31" });
    const overlap = await asOwner("post", "/api/seasons", { name: "Season B", startDate: "2026-05-31", endDate: "2026-12-31" });
    expect(overlap.status).toBe(409);
    expect((await asOwner("post", "/api/seasons", { name: "Season A", startDate: "2027-01-01" })).status).toBe(409);
    expect((await asOwner("post", "/api/seasons", { name: "Season B", startDate: "2026-06-01", endDate: "2026-12-31" })).status).toBe(201);
    // an open-ended season blocks anything after its start
    await makeSeason({ name: "Season C", startDate: "2027-01-01" });
    expect((await asOwner("post", "/api/seasons", { name: "Season D", startDate: "2030-01-01" })).status).toBe(409);
  });

  it("refuses a save when no season covers the date", async () => {
    const t = await team();
    const none = await save(today, [row(t, 5)]);
    expect(none.status).toBe(400);
    expect(none.body.errors[0].field).toBe("date");
    await makeSeason({ startDate: daysAgo(10), endDate: daysAgo(5) });
    expect((await save(today, [row(t, 5)])).status).toBe(400);
    expect((await save(daysAgo(7), [row(t, 5)], { reason: "Late entry" })).status).toBe(200);
    expect(db.production.size).toBe(1);
  });

  it("places each entry in the season covering its date", async () => {
    const a = await makeSeason({ name: "Season A", startDate: daysAgo(90), endDate: daysAgo(31) });
    const b = await makeSeason({ name: "Season B", startDate: daysAgo(30) });
    const t = await team({ joiningDate: daysAgo(80) });
    await save(daysAgo(40), [row(t, 4)], { reason: "Late entry" });
    await save(daysAgo(30), [row(t, 6)], { reason: "Late entry" });
    await save(today, [row(t, 3)]);
    expect((await entryFor(t, daysAgo(40))).seasonId).toBe(a.id);
    expect((await entryFor(t, daysAgo(30))).seasonId).toBe(b.id);
    expect((await entryFor(t, today)).seasonId).toBe(b.id);
  });

  it("a closed season takes no saves, corrections or deletes, until reopened", async () => {
    const s = await makeSeason();
    const t = await team();
    await save(today, [row(t, 5)]);
    const id = (await entryFor(t, today)).id;
    expect((await asOwner("patch", `/api/seasons/${s.id}`, { status: "CLOSED" })).body.data.status).toBe("CLOSED");
    expect((await save(today, [row(t, 6)])).status).toBe(409);
    expect((await asOwner("patch", `/api/production-entries/${id}`, { newMaaps: 6, reason: "Miscounted" })).status).toBe(409);
    expect((await asOwner("delete", `/api/production-entries/${id}`, { reason: "Wrong day" })).status).toBe(409);
    expect(liveRows(today)[0].numberOfMaaps).toBe(5);
    expect((await asOwner("patch", `/api/seasons/${s.id}`, { status: "OPEN" })).status).toBe(200);
    expect((await save(today, [row(t, 6)])).status).toBe(200);
  });

  it("changing season dates never strands existing production outside the season", async () => {
    const s = await makeSeason({ startDate: daysAgo(90), endDate: null });
    const t = await team();
    await save(daysAgo(20), [row(t, 4)], { reason: "Late entry" });
    expect((await asOwner("patch", `/api/seasons/${s.id}`, { startDate: daysAgo(10) })).status).toBe(409);
    expect((await asOwner("patch", `/api/seasons/${s.id}`, { endDate: daysAgo(30) })).status).toBe(409);
    expect((await asOwner("patch", `/api/seasons/${s.id}`, { startDate: daysAgo(40), name: "Renamed season" })).body.data).toMatchObject({ startDate: daysAgo(40), name: "Renamed season" });
    expect((await asOwner("patch", `/api/seasons/${s.id}`, {})).status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
describe("bulk daily save", () => {
  it("saves every team in one request and returns the day with totals", async () => {
    await makeSeason();
    const [a, b, c] = [await team(), await team(), await team()];
    const res = await save(today, [row(a, 4), row(b, 3, "rain"), row(c, 0)]);
    expect(res.status).toBe(200);
    expect(res.body.data.saved).toEqual({ created: 3, updated: 0, unchanged: 0 });
    expect(res.body.data.items).toHaveLength(3);
    expect(res.body.data.summary).toMatchObject({ entries: 3, maaps: 7, payableBricks: 1750, physicalBricks: 1925, earnings: 1137.5 });
    expect(res.body.data.items.find((i) => i.teamId === b.id).note).toBe("rain");
  });

  it("rejects the whole request when any row is bad, and writes nothing", async () => {
    await makeSeason();
    const good = await team();
    const bigari = await makeLabour("BIGARI");
    const res = await save(today, [row(good, 4), row(bigari, 3), { teamId: "L-999", maaps: 2 }]);
    expect(res.status).toBe(400);
    expect(res.body.errors.map((e) => e.field)).toEqual(["rows.1.teamId", "rows.2.teamId"]);
    expect(db.production.size).toBe(0);
  });

  it("rejects a team listed twice, an empty list and an unknown field", async () => {
    await makeSeason();
    const t = await team();
    expect((await save(today, [row(t, 4), row(t, 5)])).status).toBe(400);
    expect((await save(today, [])).status).toBe(400);
    expect((await asOwner("put", `/api/production-entries/day/${today}`, { rows: [row(t, 4)], extra: 1 })).status).toBe(400);
    expect(db.production.size).toBe(0);
  });

  it("saving the same numbers again changes nothing (safe retry)", async () => {
    await makeSeason();
    const t = await team();
    await save(today, [row(t, 4)]);
    const before = JSON.stringify([...db.production.values()]);
    const again = await save(today, [row(t, 4)]);
    expect(again.body.data.saved).toEqual({ created: 0, updated: 0, unchanged: 1 });
    expect(JSON.stringify([...db.production.values()])).toBe(before);
  });

  it("corrects an existing entry and creates a new one in the same save", async () => {
    await makeSeason();
    const [a, b] = [await team(), await team()];
    await save(today, [row(a, 4)]);
    const res = await save(today, [row(a, 6), row(b, 2)]);
    expect(res.body.data.saved).toEqual({ created: 1, updated: 1, unchanged: 0 });
    expect(liveRows(today)).toHaveLength(2);
    expect((await entryFor(a, today)).corrected).toBe(true);
  });

  it("a note-only change counts as an update", async () => {
    await makeSeason();
    const t = await team();
    await save(today, [row(t, 4)]);
    expect((await save(today, [row(t, 4, "late shift")])).body.data.saved.updated).toBe(1);
  });
});

// ---------------------------------------------------------------------------
describe("the duplicate rule: one live entry per team per date", () => {
  it("never creates a second live entry for the same team and date", async () => {
    await makeSeason();
    const t = await team();
    await save(today, [row(t, 4)]);
    await save(today, [row(t, 5)]);
    await save(today, [row(t, 6)]);
    expect(liveRows(today)).toHaveLength(1);
    expect(liveRows(today)[0].revision).toBe(3);
  });

  it("a first save that loses a race reports a conflict and leaves one entry", async () => {
    await makeSeason();
    const t = await team();
    db.beforeProductionUpdate = () => {
      db.beforeProductionUpdate = null;
      db.production.set("other", { _id: "other", teamId: t.id, seasonId: "x", date: today, numberOfMaaps: 7, payableBricks: 1750, ratePaise: 65000, earningsPaise: 113750, revision: 1, isDeleted: false, history: [] });
    };
    const res = await save(today, [row(t, 4)]);
    expect(res.status).toBe(409);
    expect(liveRows(today)).toHaveLength(1);
    expect(liveRows(today)[0].numberOfMaaps).toBe(7);
  });

  it("a duplicate-key error from the database becomes a 409 for that row", async () => {
    await makeSeason();
    const t = await team();
    db.failNextProductionWrite = "duplicate";
    const res = await save(today, [row(t, 4)]);
    expect(res.status).toBe(409);
    expect(res.body.errors[0].field).toBe("rows.0.teamId");
  });

  it("a change made between our read and our write is a conflict, never a lost update", async () => {
    await makeSeason();
    const t = await team();
    await save(today, [row(t, 4)]);
    db.beforeProductionUpdate = (filter) => {
      db.beforeProductionUpdate = null;
      const found = [...db.production.values()].find((r) => String(r._id) === String(filter._id));
      found.revision += 1;
      found.numberOfMaaps = 9;
    };
    expect((await save(today, [row(t, 6)])).status).toBe(409);
    expect(liveRows(today)[0].numberOfMaaps).toBe(9);
  });

  it("different teams and different days are independent", async () => {
    await makeSeason();
    const [a, b] = [await team(), await team()];
    await save(today, [row(a, 4), row(b, 4)]);
    await save(daysAgo(1), [row(a, 3)], { reason: "Late entry" });
    expect(db.production.size).toBe(3);
  });
});

// ---------------------------------------------------------------------------
describe("rate snapshots: old production is never silently recalculated", () => {
  it("copies the rate in force on the work date and keeps it after a rate change", async () => {
    await makeSeason();
    const t = await team();
    await save(today, [row(t, 4)]);
    expect((await changeRate(t, 800, today)).status).toBe(201);
    expect((await entryFor(t, today)).ratePer1000PayableBricks).toBe(650);
    await save(today, [row(t, 8)]); // correction keeps ITS rate
    const e = await entryFor(t, today);
    expect(e).toMatchObject({ ratePer1000PayableBricks: 650, newEarnings: 1300, newPayableBricks: 2000 });
  });

  it("prices a backdated day at the rate that applied then", async () => {
    await makeSeason();
    const t = await team();
    await changeRate(t, 800, daysAgo(10));
    await save(daysAgo(20), [row(t, 4)], { reason: "Late entry" });
    await save(daysAgo(5), [row(t, 4)], { reason: "Late entry" });
    expect((await entryFor(t, daysAgo(20))).ratePer1000PayableBricks).toBe(650);
    expect((await entryFor(t, daysAgo(5))).ratePer1000PayableBricks).toBe(800);
  });

  it("stores the rate and earnings as integer paise", async () => {
    await makeSeason();
    const t = await team({ ratePer1000PayableBricks: 88.5 });
    await save(today, [row(t, 1)]);
    expect(liveRows(today)[0]).toMatchObject({ ratePaise: rupeesToPaise(88.5), earningsPaise: 2213, payableBricks: 250 });
  });
});

// ---------------------------------------------------------------------------
describe("backdating and the reason", () => {
  it("needs no reason for today, and needs one for a past day that changes", async () => {
    await makeSeason();
    const t = await team();
    expect((await save(today, [row(t, 4)])).status).toBe(200);
    const res = await save(daysAgo(2), [row(t, 4)]);
    expect(res.status).toBe(400);
    expect(res.body.errors[0].field).toBe("reason");
    expect((await save(daysAgo(2), [row(t, 4)], { reason: "Forgot to enter" })).status).toBe(200);
    expect(liveRows(daysAgo(2))[0].backdatedReason).toBe("Forgot to enter");
  });

  it("a past day saved unchanged needs no reason", async () => {
    await makeSeason();
    const t = await team();
    await save(daysAgo(2), [row(t, 4)], { reason: "Forgot to enter" });
    expect((await save(daysAgo(2), [row(t, 4)])).status).toBe(200);
  });

  it("records the reason in the correction trail", async () => {
    await makeSeason();
    const t = await team();
    await save(daysAgo(2), [row(t, 4)], { reason: "Forgot to enter" });
    await save(daysAgo(2), [row(t, 5)], { reason: "Counted again" });
    const detail = (await asOwner("get", `/api/production-entries/${(await entryFor(t, daysAgo(2))).id}`)).body.data;
    expect(detail.history).toHaveLength(1);
    expect(detail.history[0]).toMatchObject({ by: "Ramesh Patel", reason: "Counted again", before: { newMaaps: 4, newPayableBricks: 1000, newEarnings: 650 } });
  });
});

// ---------------------------------------------------------------------------
describe("who can have production", () => {
  it("only Patlavale teams", async () => {
    await makeSeason();
    for (const type of ["BIGARI", "MAAPVALI"]) {
      const w = await makeLabour(type);
      const res = await save(today, [row(w, 4)]);
      expect(res.status, type).toBe(400);
      expect(res.body.errors[0].message).toMatch(/Patlavale/);
    }
  });

  it("not before the joining date, not for an unknown team", async () => {
    await makeSeason();
    const t = await team({ joiningDate: daysAgo(3) });
    expect((await save(daysAgo(5), [row(t, 4)], { reason: "Late entry" })).status).toBe(400);
    expect((await save(today, [{ teamId: "L-404", maaps: 4 }])).status).toBe(400);
    expect(db.production.size).toBe(0);
  });

  it("an inactive team cannot get new production but keeps its recorded days editable", async () => {
    await makeSeason();
    const t = await team();
    await save(today, [row(t, 4)]);
    await asOwner("patch", `/api/labours/${t.id}`, { status: "INACTIVE" });
    expect((await save(today, [row(t, 5)])).status).toBe(200);
    expect((await save(daysAgo(1), [row(t, 5)], { reason: "Late entry" })).status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
describe("business dates (IST)", () => {
  it("rejects a future date and malformed dates", async () => {
    await makeSeason();
    const t = await team();
    const future = await save(addDays(today, 1), [row(t, 4)]);
    expect(future.status).toBe(400);
    expect(future.body.errors[0].field).toBe("date");
    for (const bad of ["2026-02-30", "2026-13-01", "01-11-2026", "yesterday"]) expect((await save(bad, [row(t, 4)])).status, bad).toBe(400);
    expect(db.production.size).toBe(0);
  });

  it("uses the Indian day, not the UTC day, for 'today' and 'future'", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-02T18:15:00Z")); // 23:45 on 2 Nov in India
    owner = addUser("OWNER");
    today = todayBusinessDate();
    await makeSeason({ startDate: "2026-10-01" });
    const t = await team({ joiningDate: "2026-10-05" });
    expect((await save("2026-11-03", [row(t, 4)])).status).toBe(400);
    expect((await save("2026-11-02", [row(t, 4)])).status).toBe(200);

    vi.setSystemTime(new Date("2026-11-02T18:45:00Z")); // 00:15 on 3 Nov in India
    owner = addUser("OWNER");
    expect((await save("2026-11-03", [row(t, 4)])).status).toBe(200);
    expect((await save("2026-11-04", [row(t, 4)])).status).toBe(400);
    expect((await save("2026-11-02", [row(t, 5)])).body.errors[0].field).toBe("reason");
  });

  it("a season boundary day belongs to the season covering that exact date", async () => {
    const a = await makeSeason({ name: "Season A", startDate: "2026-09-01", endDate: "2026-10-31" });
    const b = await makeSeason({ name: "Season B", startDate: "2026-11-01" });
    const t = await team({ joiningDate: "2026-09-01" });
    await save("2026-10-31", [row(t, 4)], { reason: "Late entry" });
    await save("2026-11-01", [row(t, 4)], { reason: "Late entry" });
    expect((await entryFor(t, "2026-10-31")).seasonId).toBe(a.id);
    expect((await entryFor(t, "2026-11-01")).seasonId).toBe(b.id);
  });
});

// ---------------------------------------------------------------------------
describe("correcting one entry", () => {
  it("changes maaps and recalculates bricks and earnings from the kept rate", async () => {
    await makeSeason();
    const t = await team();
    await save(today, [row(t, 4)]);
    const id = (await entryFor(t, today)).id;
    const res = await asOwner("patch", `/api/production-entries/${id}`, { newMaaps: 7, note: "recounted", reason: "Miscounted" });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ newMaaps: 7, newPayableBricks: 1750, newEarnings: 1137.5, note: "recounted", revision: 2, corrected: true });
    expect(res.body.data.history[0].before.newMaaps).toBe(4);
  });

  it("needs a reason and at least one field, and rejects forbidden fields", async () => {
    await makeSeason();
    const t = await team();
    await save(today, [row(t, 4)]);
    const id = (await entryFor(t, today)).id;
    for (const body of [{ newMaaps: 5 }, { reason: "Miscounted" }, { newMaaps: 5, reason: "x" }, { newMaaps: 5, reason: "Miscounted", ratePer1000PayableBricks: 1 }, { newMaaps: 5, reason: "Miscounted", seasonId: "aaaaaaaaaaaaaaaaaaaaaaaa" }]) {
      expect((await asOwner("patch", `/api/production-entries/${id}`, body)).status, JSON.stringify(body)).toBe(400);
    }
    expect(liveRows(today)[0].numberOfMaaps).toBe(4);
  });

  it("a correction that changes nothing is not a new revision", async () => {
    await makeSeason();
    const t = await team();
    await save(today, [row(t, 4)]);
    const id = (await entryFor(t, today)).id;
    expect((await asOwner("patch", `/api/production-entries/${id}`, { newMaaps: 4, reason: "Same again" })).body.data.revision).toBe(1);
  });

  it("moving the date re-places the entry in the right season and refuses a taken or future date", async () => {
    const a = await makeSeason({ name: "Season A", startDate: daysAgo(90), endDate: daysAgo(31) });
    const b = await makeSeason({ name: "Season B", startDate: daysAgo(30) });
    const t = await team({ joiningDate: daysAgo(80) });
    await save(today, [row(t, 4)]);
    await save(daysAgo(1), [row(t, 3)], { reason: "Late entry" });
    const id = (await entryFor(t, today)).id;
    expect((await asOwner("patch", `/api/production-entries/${id}`, { date: daysAgo(1), reason: "Wrong day" })).status).toBe(409);
    expect((await asOwner("patch", `/api/production-entries/${id}`, { date: addDays(today, 1), reason: "Wrong day" })).status).toBe(400);
    const moved = await asOwner("patch", `/api/production-entries/${id}`, { date: daysAgo(40), reason: "Wrong day" });
    expect(moved.status).toBe(200);
    expect(moved.body.data).toMatchObject({ date: daysAgo(40), seasonId: a.id });
    expect(moved.body.data.history[0].before.seasonId).toBe(b.id);
    expect((await asOwner("patch", `/api/production-entries/${id}`, { date: daysAgo(100), reason: "Wrong day" })).status).toBe(400); // no season there
  });

  it("returns 404 for an unknown entry and 400 for a malformed id", async () => {
    expect((await asOwner("patch", "/api/production-entries/aaaaaaaaaaaaaaaaaaaaaaaa", { newMaaps: 1, reason: "Miscounted" })).status).toBe(404);
    expect((await asOwner("patch", "/api/production-entries/nope", { newMaaps: 1, reason: "Miscounted" })).status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
describe("deleting an entry (soft)", () => {
  it("keeps the record, leaves it out of totals, and frees the slot for a new entry", async () => {
    const s = await makeSeason();
    const t = await team();
    await save(today, [row(t, 4)]);
    const id = (await entryFor(t, today)).id;
    expect((await asOwner("delete", `/api/production-entries/${id}`, {})).status).toBe(400); // reason required
    const res = await asOwner("delete", `/api/production-entries/${id}`, { reason: "Wrong day" });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ isDeleted: true, deletedReason: "Wrong day", deletedBy: "Ramesh Patel" });
    expect(db.production.size).toBe(1);
    expect((await seasonTotals(s)).summary).toMatchObject({ entries: 0, maaps: 0, payableBricks: 0 });
    expect((await save(today, [row(t, 6)])).status).toBe(200);
    expect(db.production.size).toBe(2);
    expect((await seasonTotals(s)).summary).toMatchObject({ entries: 1, maaps: 6, payableBricks: 1500 });
  });

  it("cannot delete twice or correct a deleted entry", async () => {
    await makeSeason();
    const t = await team();
    await save(today, [row(t, 4)]);
    const id = (await entryFor(t, today)).id;
    await asOwner("delete", `/api/production-entries/${id}`, { reason: "Wrong day" });
    expect((await asOwner("delete", `/api/production-entries/${id}`, { reason: "Wrong day" })).status).toBe(409);
    expect((await asOwner("patch", `/api/production-entries/${id}`, { newMaaps: 5, reason: "Miscounted" })).status).toBe(409);
  });
});

// ---------------------------------------------------------------------------
describe("history: by date, by team and by season", () => {
  const setup = async () => {
    const a = await makeSeason({ name: "Season A", startDate: daysAgo(90), endDate: daysAgo(31) });
    const b = await makeSeason({ name: "Season B", startDate: daysAgo(30) });
    const [t1, t2] = [await team({ joiningDate: daysAgo(80) }), await team({ joiningDate: daysAgo(80) })];
    await save(daysAgo(40), [row(t1, 4), row(t2, 2)], { reason: "Late entry" });
    await save(daysAgo(2), [row(t1, 3), row(t2, 5)], { reason: "Late entry" });
    await save(today, [row(t1, 7)]);
    return { a, b, t1, t2 };
  };

  it("date-wise: one day, and a range newest first with totals over every match", async () => {
    await setup();
    const day = (await asOwner("get", `/api/production-entries?date=${daysAgo(2)}`)).body.data;
    expect(day.items).toHaveLength(2);
    expect(day.summary).toMatchObject({ maaps: 8, payableBricks: 2000 });
    const range = (await asOwner("get", `/api/production-entries?from=${daysAgo(3)}&to=${today}&limit=2`)).body;
    expect(range.data).toHaveLength(2);
    expect(range.data[0].date).toBe(today);
    expect(range.meta).toMatchObject({ total: 3, page: 1, limit: 2 });
    expect(range.meta.summary).toMatchObject({ entries: 3, maaps: 15, payableBricks: 3750 });
  });

  it("team-wise: one team's history with its totals, empty for a non-Patlavale labour", async () => {
    const { t1, b } = await setup();
    const all = (await asOwner("get", `/api/labours/${t1.id}/production-entries`)).body;
    expect(all.data.map((e) => e.date)).toEqual([today, daysAgo(2), daysAgo(40)]);
    expect(all.meta.summary).toMatchObject({ entries: 3, maaps: 14, payableBricks: 3500 });
    const inB = (await asOwner("get", `/api/labours/${t1.id}/production-entries?seasonId=${b.id}`)).body;
    expect(inB.meta.summary).toMatchObject({ entries: 2, maaps: 10 });
    const bigari = await makeLabour("BIGARI");
    expect((await asOwner("get", `/api/labours/${bigari.id}/production-entries`)).body.data).toEqual([]);
    expect((await asOwner("get", "/api/labours/L-404/production-entries")).status).toBe(404);
  });

  it("season-wise: a list filter and per-team season totals", async () => {
    const { a, b, t1, t2 } = await setup();
    const inA = (await asOwner("get", `/api/production-entries?seasonId=${a.id}`)).body;
    expect(inA.meta.summary).toMatchObject({ entries: 2, maaps: 6, payableBricks: 1500 });
    const totals = await seasonTotals(b);
    expect(totals.season.id).toBe(b.id);
    expect(totals.summary).toMatchObject({ entries: 3, maaps: 15, payableBricks: 3750, physicalBricks: 4125 });
    expect(totals.teams.map((t) => [t.teamId, t.maaps, t.payableBricks])).toEqual([[t1.id, 10, 2500], [t2.id, 5, 1250]].sort());
    expect((await asOwner("get", "/api/seasons/aaaaaaaaaaaaaaaaaaaaaaaa/production")).status).toBe(404);
  });

  it("voided entries are only shown when asked for", async () => {
    await makeSeason();
    const t = await team();
    await save(today, [row(t, 4)]);
    await asOwner("delete", `/api/production-entries/${(await entryFor(t, today)).id}`, { reason: "Wrong day" });
    expect((await asOwner("get", `/api/production-entries?date=${today}`)).body.data.items).toHaveLength(0);
    expect((await asOwner("get", `/api/production-entries?date=${today}&includeDeleted=true`)).body.data.items).toHaveLength(1);
  });

  it("needs a date, a range or a season, and rejects contradictory queries", async () => {
    for (const q of ["", `date=${today}&from=${today}`, `from=${today}&to=${daysAgo(3)}`, "seasonId=nope", `date=${today}&x=1`]) {
      expect((await asOwner("get", `/api/production-entries?${q}`)).status, q).toBe(400);
    }
  });
});

// ---------------------------------------------------------------------------
describe("season totals accumulate and are independent of payments", () => {
  it("keeps adding up day after day, with no floor and no carry-forward", async () => {
    const s = await makeSeason();
    const t = await team();
    let maaps = 0;
    for (const [i, m] of [3, 5, 7, 1, 4].entries()) {
      await save(daysAgo(4 - i), [row(t, m)], { reason: "Late entry" });
      maaps += m;
      const { summary } = await seasonTotals(s);
      expect(summary.maaps).toBe(maaps);
      expect(summary.payableBricks).toBe(maaps * 250);
    }
    expect((await seasonTotals(s)).summary).toMatchObject({ maaps: 20, payableBricks: 5000, earnings: 3250 });
  });

  it("a payment cannot reduce production: totals are built from entries only", () => {
    const rows = [
      { numberOfMaaps: 4, payableBricks: 1000, earningsPaise: 65000, paid: 99999, amountPaid: 50000 },
      { numberOfMaaps: 3, payableBricks: 750, earningsPaise: 48750, payment: -100 },
    ];
    expect(summarizeProduction(rows)).toEqual({ entries: 2, maaps: 7, payableBricks: 1750, physicalBricks: 1925, earningsPaise: 113750 });
  });

  it("no production module reads or writes anything payment-related", () => {
    for (const file of ["services/productionEntry.service.js", "services/productionCalculations.js", "services/season.service.js", "controllers/productionEntry.controller.js", "controllers/season.controller.js", "routes/productionEntry.routes.js", "routes/season.routes.js", "models/ProductionEntry.js", "models/Season.js", "validators/productionEntry.validators.js", "validators/season.validators.js"]) {
      const imports = readFileSync(new URL(`../${file}`, import.meta.url), "utf8").split("\n").filter((line) => /^\s*import\b/.test(line)).join("\n").toLowerCase();
      for (const word of ["payment", "salary", "attendance", "maapentry"]) expect(imports, `${file} ${word}`).not.toContain(word);
    }
  });

  it("the stored entry and the season response hold no payment fields", async () => {
    const s = await makeSeason();
    const t = await team();
    await save(today, [row(t, 4)]);
    for (const field of ["paid", "amountPaid", "balance", "payment"]) {
      expect(liveRows(today)[0]).not.toHaveProperty(field);
      expect((await seasonTotals(s)).summary).not.toHaveProperty(field);
    }
  });

  it("saving, correcting and deleting change nothing outside seasons and production", async () => {
    await makeSeason();
    const t = await team();
    const snapshot = () => JSON.stringify([[...db.labours.values()], db.rates, [...db.attendance.values()], [...db.maap.values()]]);
    const before = snapshot();
    await save(today, [row(t, 4)]);
    const id = (await entryFor(t, today)).id;
    await asOwner("patch", `/api/production-entries/${id}`, { newMaaps: 6, reason: "Miscounted" });
    await asOwner("delete", `/api/production-entries/${id}`, { reason: "Wrong day" });
    expect(snapshot()).toBe(before);
  });
});

// ---------------------------------------------------------------------------
describe("models", () => {
  const valid = { teamId: "L-001", seasonId: "aaaaaaaaaaaaaaaaaaaaaaaa", date: "2026-11-01", numberOfMaaps: 4, payableBricks: 1000, ratePaise: 65000, earningsPaise: 65000 };
  const errorsOf = (data) => new RealProductionEntry(data).validateSync()?.errors ?? {};

  it("accepts a valid entry with sensible defaults", () => {
    const doc = new RealProductionEntry(valid);
    expect(doc.validateSync()).toBeUndefined();
    expect(doc).toMatchObject({ revision: 1, isDeleted: false, note: "" });
  });

  it("rejects bad maaps, rates, ids and dates, and drops unknown fields", () => {
    for (const numberOfMaaps of [-1, 1.5, 10000]) expect(errorsOf({ ...valid, numberOfMaaps }).numberOfMaaps, String(numberOfMaaps)).toBeDefined();
    expect(errorsOf({ ...valid, payableBricks: 1.5 }).payableBricks).toBeDefined();
    expect(errorsOf({ ...valid, ratePaise: 0 }).ratePaise).toBeDefined();
    expect(errorsOf({ ...valid, earningsPaise: -1 }).earningsPaise).toBeDefined();
    expect(errorsOf({ ...valid, teamId: "X-1" }).teamId).toBeDefined();
    expect(errorsOf({ ...valid, date: "2026-02-30" }).date).toBeDefined();
    expect(errorsOf({})).toHaveProperty("teamId");
    expect(errorsOf({})).toHaveProperty("seasonId");
    expect(new RealProductionEntry({ ...valid, amountPaid: 500 }).get("amountPaid")).toBeUndefined();
  });

  it("season: needs a name and a start date, defaults to OPEN, rejects a bad status or date", () => {
    const ok = { name: "Season 2026-27", startDate: "2026-10-01" };
    const doc = new RealSeason(ok);
    expect(doc.validateSync()).toBeUndefined();
    expect(doc).toMatchObject({ status: "OPEN", endDate: null, revision: 1 });
    expect(new RealSeason({ ...ok, status: "DONE" }).validateSync().errors.status).toBeDefined();
    expect(new RealSeason({ ...ok, endDate: "2026-02-30" }).validateSync().errors.endDate).toBeDefined();
    expect(new RealSeason({}).validateSync().errors).toHaveProperty("name");
  });
});
