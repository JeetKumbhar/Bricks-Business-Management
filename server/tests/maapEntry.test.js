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
const { db, makeAttendanceModel, makeCounterModel, makeLabourModel, makeMaapEntryModel, makeRateModel } = await import("./helpers/memoryDb.js");
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

const { createApp } = await import("../app.js");
const { signAccessToken } = await import("../services/auth.service.js");
const { maapvaliEarningsPaise, summarizeMaapEntries } = await import("../services/maapCalculations.js");
const { addDays, todayBusinessDate } = await import("../utils/dates.js");
const { paiseToRupeeString, rupeesToPaise } = await import("../utils/money.js");
const RealMaapEntry = (await vi.importActual("../models/MaapEntry.js")).default;

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
const RATES = { BIGARI: { dailyRate: 650 }, PATLAVALE: { ratePer1000PayableBricks: 650 } };
const makeLabour = async (labourType, o = {}) => {
  const rate = labourType === "MAAPVALI" ? { ratePerFourMaaps: 250 } : RATES[labourType];
  const res = await asOwner("post", "/api/labours", { labourType, name: `Worker ${mobileSeq + 1}`, mobile: `98100${String(10000 + (mobileSeq += 1))}`, village: "Sinnar", joiningDate: daysAgo(60), ...rate, ...o });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.data;
};
const maapvali = (o) => makeLabour("MAAPVALI", o);

const save = (date, rows, extra = {}) => asOwner("put", `/api/maap-entries/day/${date}`, { rows, ...extra });
const row = (worker, maaps, note) => ({ labourId: worker.id, maaps, ...(note === undefined ? {} : { note }) });
const liveRows = (date) => [...db.maap.values()].filter((r) => r.date === date && !r.isDeleted);
const changeRate = (worker, newRate, effectiveFrom) => asOwner("post", `/api/labours/${worker.id}/rates`, { newRate, effectiveFrom, reason: "Revised rate" });
const entryFor = async (worker, date) => (await asOwner("get", `/api/maap-entries?date=${date}`)).body.data.items.find((i) => i.labourId === worker.id);

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
  it("needs a login for every Maapvali work route", async () => {
    for (const [method, url] of [
      ["get", `/api/maap-entries?date=${today}`],
      ["put", `/api/maap-entries/day/${today}`],
      ["get", "/api/maap-entries/aaaaaaaaaaaaaaaaaaaaaaaa"],
      ["patch", "/api/maap-entries/aaaaaaaaaaaaaaaaaaaaaaaa"],
      ["delete", "/api/maap-entries/aaaaaaaaaaaaaaaaaaaaaaaa"],
      ["get", "/api/labours/L-001/maap-entries"],
    ]) {
      expect((await send(method, url, null, method === "get" ? undefined : {})).status, `${method} ${url}`).toBe(401);
    }
  });

  it("lets a non-owner read but not save, correct or delete", async () => {
    const w = await maapvali();
    await save(today, [row(w, 10)]);
    const entry = await entryFor(w, today);
    expect((await send("get", `/api/maap-entries?date=${today}`, manager.cookie)).status).toBe(200);
    expect((await send("put", `/api/maap-entries/day/${today}`, manager.cookie, { rows: [row(w, 11)] })).status).toBe(403);
    expect((await send("patch", `/api/maap-entries/${entry.id}`, manager.cookie, { numberOfMaaps: 5, reason: "Fix it" })).status).toBe(403);
    expect((await send("delete", `/api/maap-entries/${entry.id}`, manager.cookie, { reason: "Wrong day" })).status).toBe(403);
    expect(liveRows(today)[0].numberOfMaaps).toBe(10);
  });
});

// ---------------------------------------------------------------------------
describe("the formula: earnings = (maaps / 4) x rate per 4 maaps, every maap paid", () => {
  it.each([
    [0, "0.00"],
    [1, "62.50"],
    [2, "125.00"],
    [3, "187.50"],
    [4, "250.00"],
    [5, "312.50"],
    [7, "437.50"],
    [41, "2562.50"],
    [9999, "624937.50"],
  ])("at 250 per 4 maaps, %i maaps = %s", (maaps, expected) => {
    expect(paiseToRupeeString(maapvaliEarningsPaise(maaps, 25000))).toBe(expected);
  });

  it("is proportional: no flooring to groups of 4, no carry-forward, no discarded maaps", () => {
    expect(maapvaliEarningsPaise(41, 25000)).toBe(256250); // not 40 maaps = 250 x 10
    expect(maapvaliEarningsPaise(41, 25000) - maapvaliEarningsPaise(40, 25000)).toBe(6250); // the 41st maap is paid on its own
    expect(maapvaliEarningsPaise(1, 25000) * 4).toBe(maapvaliEarningsPaise(4, 25000)); // 1 maap four times = 4 maaps
  });

  it("rounds half up in paise, once", () => {
    expect(maapvaliEarningsPaise(1, rupeesToPaise("88.5"))).toBe(2213); // 22.125
    expect(maapvaliEarningsPaise(3, rupeesToPaise("88.5"))).toBe(6638); // 66.375
    expect(maapvaliEarningsPaise(1, rupeesToPaise("88.02"))).toBe(2201); // 22.005 -> 22.01
  });

  it("refuses maaps that are not whole numbers from 0 to 9999", () => {
    for (const bad of [-1, 1.5, 10000, NaN, "5", null, undefined]) expect(() => maapvaliEarningsPaise(bad, 25000), String(bad)).toThrow(RangeError);
  });

  it("is what the endpoint stores and returns", async () => {
    const w = await maapvali();
    for (const [i, [maaps, expected]] of [[1, 62.5], [4, 250], [5, 312.5], [41, 2562.5], [0, 0]].entries()) {
      await save(daysAgo(i + 1), [row(w, maaps)], { reason: "Late entry" });
      const e = await entryFor(w, daysAgo(i + 1));
      expect(e, `${maaps} maaps`).toMatchObject({ numberOfMaaps: maaps, ratePerFourMaaps: 250, earnings: expected });
    }
    expect(liveRows(daysAgo(4))[0]).toMatchObject({ ratePaise: 25000, earningsPaise: 256250 });
  });

  it("a day's total is the sum of each entry's own stored earnings (rounded once per entry)", async () => {
    const [a, b] = [await maapvali({ ratePerFourMaaps: 88.5 }), await maapvali({ ratePerFourMaaps: 88.5 })];
    const res = await save(today, [row(a, 1), row(b, 1)]);
    expect(res.body.data.items.map((i) => i.earnings)).toEqual([22.13, 22.13]);
    expect(res.body.data.summary).toEqual({ entries: 2, maaps: 2, earnings: 44.26, estimatedBricks: 550 }); // 44.26, not 44.25: accepted rule
  });

  it("summarizeMaapEntries adds stored earnings and never recomputes from total maaps", () => {
    expect(summarizeMaapEntries([{ numberOfMaaps: 1, earningsPaise: 2213 }, { numberOfMaaps: 1, earningsPaise: 2213 }])).toEqual({ entries: 2, maaps: 2, earningsPaise: 4426, estimatedBricks: 550 });
    expect(summarizeMaapEntries([])).toEqual({ entries: 0, maaps: 0, earningsPaise: 0, estimatedBricks: 0 });
  });
});

// ---------------------------------------------------------------------------
describe("bulk daily save", () => {
  it("saves the intended workers with their own counts, and reads them back with the day's totals", async () => {
    const [a, b, c] = [await maapvali(), await maapvali(), await maapvali()];
    const res = await save(today, [row(a, 41), row(b, 5, "Short day"), row(c, 0)]);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.saved).toEqual({ created: 3, updated: 0, unchanged: 0 });
    expect(res.body.data.summary).toEqual({ entries: 3, maaps: 46, earnings: 2875, estimatedBricks: 12650 });

    const day = (await asOwner("get", `/api/maap-entries?date=${today}`)).body.data;
    expect(day.items.map((i) => [i.labourId, i.numberOfMaaps, i.earnings, i.note])).toEqual([["L-001", 41, 2562.5, ""], ["L-002", 5, 312.5, "Short day"], ["L-003", 0, 0, ""]]);
    expect(day.summary.maaps).toBe(46);
  });

  it("saves only the workers sent: everyone else gets no entry", async () => {
    const a = await maapvali();
    await maapvali();
    await save(today, [row(a, 10)]);
    expect(liveRows(today)).toHaveLength(1);
  });

  it("keeps an explicit zero as an entry (blank rows are simply not sent)", async () => {
    const a = await maapvali();
    await save(today, [row(a, 0)]);
    expect(liveRows(today)[0]).toMatchObject({ numberOfMaaps: 0, earningsPaise: 0 });
  });

  it("keeps days apart", async () => {
    const a = await maapvali();
    await save(daysAgo(1), [row(a, 20)], { reason: "Yesterday's sheet" });
    await save(today, [row(a, 30)]);
    expect((await entryFor(a, daysAgo(1))).numberOfMaaps).toBe(20);
    expect((await entryFor(a, today)).numberOfMaaps).toBe(30);
  });

  it("rejects counts that are negative, fractional, text, too big or missing", async () => {
    const a = await maapvali();
    for (const maaps of [-1, 1.5, "12", 10000, null, undefined]) {
      const res = await save(today, [{ labourId: a.id, maaps }]);
      expect(res.status, String(maaps)).toBe(400);
      expect(res.body.errors.map((e) => e.field)).toContain("rows.0.maaps");
    }
    expect(db.maap.size).toBe(0);
  });

  it("rejects bad shapes, fields the client must not send, and the same worker twice", async () => {
    const a = await maapvali();
    const bad = async (body, field) => {
      const res = await asOwner("put", `/api/maap-entries/day/${today}`, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      if (field) expect(res.body.errors.map((e) => e.field)).toContain(field);
      expect(db.maap.size).toBe(0);
    };
    await bad({ rows: [] });
    await bad({});
    await bad({ rows: [{ ...row(a, 5), ratePerFourMaaps: 999 }] }); // the rate is never accepted from the client
    await bad({ rows: [{ ...row(a, 5), earnings: 1 }] });
    await bad({ rows: [row(a, 5)], id: "x" });
    await bad({ rows: [{ labourId: "nope", maaps: 5 }] }, "rows.0.labourId");
    await bad({ rows: [{ labourId: { $ne: "" }, maaps: 5 }] });
    await bad({ rows: [row(a, 5, "x".repeat(201))] }, "rows.0.note");
    await bad({ rows: [row(a, 5), row(a, 6)] }, "rows.1.labourId");
    await bad({ rows: Array.from({ length: 501 }, () => row(a, 1)) });
  });
});

// ---------------------------------------------------------------------------
describe("the duplicate rule: one live entry per worker per date", () => {
  it("is enforced by a partial unique index, and identity fields cannot change", () => {
    const index = RealMaapEntry.schema.indexes().find(([f, o]) => f.labourId === 1 && f.date === 1 && o.unique);
    expect(index?.[1].partialFilterExpression).toEqual({ isDeleted: false });
    expect(RealMaapEntry.schema.path("labourId").options.immutable).toBe(true);
    expect(RealMaapEntry.schema.path("ratePaise").options.immutable).toBe(true);
  });

  it("saving the same numbers again creates nothing and changes nothing", async () => {
    const a = await maapvali();
    await save(today, [row(a, 12, "Morning")]);
    const again = await save(today, [row(a, 12, "Morning")]);
    expect(again.body.data.saved).toEqual({ created: 0, updated: 0, unchanged: 1 });
    expect(liveRows(today)).toHaveLength(1);
    expect(liveRows(today)[0]).toMatchObject({ revision: 1, history: [] });
  });

  it("different numbers correct the SAME entry and keep what it replaced", async () => {
    const a = await maapvali();
    await save(today, [row(a, 10)]);
    const id = (await entryFor(a, today)).id;
    const res = await save(today, [row(a, 14)]);
    expect(res.body.data.saved).toEqual({ created: 0, updated: 1, unchanged: 0 });
    expect(liveRows(today)).toHaveLength(1);
    expect(res.body.data.items[0]).toMatchObject({ id, numberOfMaaps: 14, earnings: 875, revision: 2, corrected: true });

    const detail = (await asOwner("get", `/api/maap-entries/${id}`)).body.data;
    expect(detail.history).toEqual([expect.objectContaining({ by: "Ramesh Patel", reason: "Daily entry updated", before: { date: today, numberOfMaaps: 10, note: "", earnings: 625 } })]);
  });

  it("a note change alone is a correction; a mixed save counts each kind", async () => {
    const [a, b, c] = [await maapvali(), await maapvali(), await maapvali()];
    await save(today, [row(a, 10), row(b, 10)]);
    const res = await save(today, [row(a, 10, "Added a note"), row(b, 10), row(c, 7)]);
    expect(res.body.data.saved).toEqual({ created: 1, updated: 1, unchanged: 1 });
  });

  it("an entry saved by someone else mid-save is a 409, never a duplicate, and is not overwritten", async () => {
    const a = await maapvali();
    db.beforeMaapUpdate = () => {
      db.beforeMaapUpdate = null;
      db.maap.set("x", { _id: "x", labourId: a.id, date: today, numberOfMaaps: 99, ratePaise: 25000, earningsPaise: 618750, note: "", revision: 1, history: [], isDeleted: false });
    };
    const res = await save(today, [row(a, 10)]);
    expect(res.status).toBe(409);
    expect(res.body.errors[0].field).toBe("rows.0.labourId");
    expect(liveRows(today)).toHaveLength(1);
    expect(liveRows(today)[0].numberOfMaaps).toBe(99);
  });

  it("a duplicate-key error from the database is also a 409", async () => {
    const a = await maapvali();
    db.failNextMaapWrite = "duplicate";
    expect((await save(today, [row(a, 10)])).status).toBe(409);
    expect(db.maap.size).toBe(0);
  });

  it("an entry corrected by someone else mid-save is not overwritten; the rest is saved and a retry is safe", async () => {
    const [a, b] = [await maapvali(), await maapvali()];
    await save(today, [row(a, 10), row(b, 10)]);
    db.beforeMaapUpdate = (filter) => {
      if (filter.revision === undefined || [...db.maap.values()].find((r) => String(r._id) === String(filter._id))?.labourId !== a.id) return;
      db.beforeMaapUpdate = null;
      const mine = [...db.maap.values()].find((r) => r.labourId === a.id);
      mine.numberOfMaaps = 50;
      mine.revision += 1;
    };
    const res = await save(today, [row(a, 20), row(b, 20)]);
    expect(res.status).toBe(409);
    expect(res.body.errors.map((e) => e.field)).toEqual(["rows.0.labourId"]);
    expect([...db.maap.values()].find((r) => r.labourId === a.id).numberOfMaaps).toBe(50);
    expect([...db.maap.values()].find((r) => r.labourId === b.id).numberOfMaaps).toBe(20);

    const retry = await save(today, [row(a, 20), row(b, 20)]);
    expect(retry.status).toBe(200);
    expect(retry.body.data.saved).toEqual({ created: 0, updated: 1, unchanged: 1 });
  });
});

// ---------------------------------------------------------------------------
describe("rate snapshots: old work is never silently recalculated", () => {
  it("a new entry gets the rate in force on its work date", async () => {
    const w = await maapvali({ joiningDate: daysAgo(60) });
    await changeRate(w, 300, daysAgo(10));
    await save(daysAgo(20), [row(w, 4)], { reason: "Late entry" });
    await save(daysAgo(5), [row(w, 4)], { reason: "Late entry" });
    await save(today, [row(w, 4)]);
    expect((await entryFor(w, daysAgo(20))).ratePerFourMaaps).toBe(250);
    expect((await entryFor(w, daysAgo(5))).ratePerFourMaaps).toBe(300);
    expect((await entryFor(w, today)).earnings).toBe(300);
  });

  it("a later rate change leaves every saved entry, and the totals, exactly as they were", async () => {
    const w = await maapvali({ joiningDate: daysAgo(60) });
    await save(daysAgo(3), [row(w, 41)], { reason: "Late entry" });
    await save(today, [row(w, 5)]);
    const before = (await asOwner("get", `/api/labours/${w.id}/maap-entries`)).body;
    expect(before.data.map((e) => e.earnings)).toEqual([312.5, 2562.5]);

    expect((await changeRate(w, 400, daysAgo(1))).status).toBe(201);
    const after = (await asOwner("get", `/api/labours/${w.id}/maap-entries`)).body;
    expect(after.data.map((e) => [e.ratePerFourMaaps, e.earnings])).toEqual([[250, 312.5], [250, 2562.5]]);
    expect(after.meta.summary).toEqual(before.meta.summary);
  });

  it("correcting an old entry uses that entry's own rate, not the current one", async () => {
    const w = await maapvali({ joiningDate: daysAgo(60) });
    await save(daysAgo(3), [row(w, 4)], { reason: "Late entry" });
    await changeRate(w, 400, daysAgo(1));
    const id = (await entryFor(w, daysAgo(3))).id;

    const patched = await asOwner("patch", `/api/maap-entries/${id}`, { numberOfMaaps: 8, reason: "Miscounted" });
    expect(patched.body.data).toMatchObject({ numberOfMaaps: 8, ratePerFourMaaps: 250, earnings: 500 });

    const viaBulk = await save(daysAgo(3), [row(w, 12)], { reason: "Counted again" });
    expect(viaBulk.body.data.items[0]).toMatchObject({ ratePerFourMaaps: 250, earnings: 750 });
    expect(liveRows(daysAgo(3))[0].ratePaise).toBe(25000);
  });

  it("the stored snapshot cannot be set by the client or changed by an update", async () => {
    const w = await maapvali();
    await save(today, [row(w, 4)]);
    const id = (await entryFor(w, today)).id;
    expect((await asOwner("patch", `/api/maap-entries/${id}`, { ratePerFourMaaps: 999, numberOfMaaps: 4, reason: "Try it" })).status).toBe(400);
    expect((await asOwner("patch", `/api/maap-entries/${id}`, { ratePaise: 1, reason: "Try it" })).status).toBe(400);
    expect(liveRows(today)[0].ratePaise).toBe(25000);
  });

  it("the entry keeps the rate it was earned at even when the worker has no later rate", async () => {
    const w = await maapvali({ ratePerFourMaaps: 88.5 });
    await save(today, [row(w, 3)]);
    expect(liveRows(today)[0]).toMatchObject({ ratePaise: 8850, earningsPaise: 6638 });
  });
});

// ---------------------------------------------------------------------------
describe("backdating and the reason", () => {
  it("needs a reason before today when something changes, and writes nothing without it", async () => {
    const w = await maapvali();
    const res = await save(daysAgo(2), [row(w, 10)]);
    expect(res.status).toBe(400);
    expect(res.body.errors[0].field).toBe("reason");
    expect(db.maap.size).toBe(0);
    expect((await save(daysAgo(2), [row(w, 10)], { reason: "ab" })).status).toBe(400);
  });

  it("keeps the reason on a backdated new entry and in the history of a backdated correction", async () => {
    const w = await maapvali();
    await save(daysAgo(2), [row(w, 10)], { reason: "Forgot to enter" });
    expect(liveRows(daysAgo(2))[0].backdatedReason).toBe("Forgot to enter");
    await save(daysAgo(2), [row(w, 12)], { reason: "Counted again" });
    expect(liveRows(daysAgo(2))[0].history[0].reason).toBe("Counted again");
  });

  it("needs no reason for today, nor for a past day that is saved unchanged", async () => {
    const w = await maapvali();
    expect((await save(today, [row(w, 10)])).status).toBe(200);
    await save(daysAgo(2), [row(w, 10)], { reason: "Forgot to enter" });
    const again = await save(daysAgo(2), [row(w, 10)]);
    expect(again.status).toBe(200);
    expect(again.body.data.saved.unchanged).toBe(1);
  });
});

// ---------------------------------------------------------------------------
describe("who can have Maapvali work", () => {
  it("rejects the whole request when any row is invalid, and writes nothing", async () => {
    const good = await maapvali();
    const bigari = await makeLabour("BIGARI");
    const res = await save(today, [row(good, 10), row(bigari, 10)]);
    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual([{ field: "rows.1.labourId", message: "Maap work is only for Maapvali workers" }]);
    expect(db.maap.size).toBe(0);
  });

  it("refuses Patlavale teams and unknown labour", async () => {
    const team = await makeLabour("PATLAVALE");
    expect((await save(today, [row(team, 10)])).status).toBe(400);
    const unknown = await save(today, [{ labourId: "L-999", maaps: 5 }]);
    expect(unknown.body.errors[0].message).toBe("Labour not found");
  });

  it("refuses a date before the worker joined, and allows the joining day", async () => {
    const w = await maapvali({ joiningDate: daysAgo(5) });
    const early = await save(daysAgo(6), [row(w, 10)], { reason: "Late entry" });
    expect(early.status).toBe(400);
    expect(early.body.errors[0].message).toContain("after this date");
    expect((await save(daysAgo(5), [row(w, 10)], { reason: "Late entry" })).status).toBe(200);
  });

  it("refuses new work for an inactive worker, but their old days stay correctable", async () => {
    const w = await maapvali();
    await save(daysAgo(3), [row(w, 10)], { reason: "Late entry" });
    await asOwner("patch", `/api/labours/${w.id}`, { status: "INACTIVE", statusReason: "Left the job" });
    const fresh = await save(daysAgo(2), [row(w, 10)], { reason: "Late entry" });
    expect(fresh.status).toBe(400);
    expect(fresh.body.errors[0].message).toContain("inactive");
    expect((await save(daysAgo(3), [row(w, 12)], { reason: "Counted again" })).status).toBe(200);
  });
});

describe("business dates (IST)", () => {
  it("rejects a future date and malformed or impossible dates", async () => {
    const w = await maapvali();
    const future = await save(addDays(today, 1), [row(w, 10)]);
    expect(future.status).toBe(400);
    expect(future.body.errors[0].field).toBe("date");
    for (const bad of ["2026-02-30", "2026-13-01", "01-11-2026", "yesterday"]) expect((await save(bad, [row(w, 10)])).status, bad).toBe(400);
    expect(db.maap.size).toBe(0);
  });

  it("uses the Indian day, not the UTC day, for 'today' and 'future'", async () => {
    const w = await maapvali();
    vi.useFakeTimers({ toFake: ["Date"] });

    vi.setSystemTime(new Date("2026-11-02T18:15:00Z")); // 23:45 on 2 Nov in India
    owner = addUser("OWNER");
    expect((await save("2026-11-03", [row(w, 10)])).status).toBe(400);
    expect((await save("2026-11-02", [row(w, 10)])).status).toBe(200); // today: no reason needed

    vi.setSystemTime(new Date("2026-11-02T18:45:00Z")); // 00:15 on 3 Nov in India, still 2 Nov in UTC
    owner = addUser("OWNER");
    expect((await save("2026-11-03", [row(w, 10)])).status).toBe(200); // now today: no reason needed
    expect((await save("2026-11-04", [row(w, 10)])).status).toBe(400);
    const yesterday = await save("2026-11-02", [row(w, 11)]); // now a past day: a reason is needed
    expect(yesterday.status).toBe(400);
    expect(yesterday.body.errors[0].field).toBe("reason");
  });

  it("stores the date exactly as sent, as a plain string", async () => {
    const w = await maapvali();
    await save("2026-10-31", [row(w, 10)], { reason: "Late entry" });
    expect(liveRows("2026-10-31")[0].date).toBe("2026-10-31");
  });
});

// ---------------------------------------------------------------------------
describe("correcting one entry", () => {
  const setup = async () => {
    const w = await maapvali({ joiningDate: daysAgo(30) });
    await save(daysAgo(4), [row(w, 10)], { reason: "Late entry" });
    return { w, id: (await entryFor(w, daysAgo(4))).id };
  };

  it("changes the maaps and recalculates earnings from the entry's own rate", async () => {
    const { id } = await setup();
    const res = await asOwner("patch", `/api/maap-entries/${id}`, { numberOfMaaps: 41, reason: "Miscounted" });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data).toMatchObject({ id, numberOfMaaps: 41, earnings: 2562.5, revision: 2 });
    expect(res.body.data.history[0]).toMatchObject({ by: "Ramesh Patel", reason: "Miscounted", before: { numberOfMaaps: 10, earnings: 625 } });
  });

  it("always needs a reason, and at least one field", async () => {
    const { id } = await setup();
    expect((await asOwner("patch", `/api/maap-entries/${id}`, { numberOfMaaps: 5 })).status).toBe(400);
    expect((await asOwner("patch", `/api/maap-entries/${id}`, { numberOfMaaps: 5, reason: "ab" })).status).toBe(400);
    expect((await asOwner("patch", `/api/maap-entries/${id}`, { reason: "Nothing to change" })).status).toBe(400);
    expect((await asOwner("patch", `/api/maap-entries/${id}`, { numberOfMaaps: 1.5, reason: "Half maap" })).status).toBe(400);
    expect((await asOwner("patch", `/api/maap-entries/${id}`, { numberOfMaaps: -2, reason: "Negative" })).status).toBe(400);
    expect(liveRows(daysAgo(4))[0].revision).toBe(1);
  });

  it("changes the note alone, and treats an identical correction as nothing to do", async () => {
    const { id } = await setup();
    expect((await asOwner("patch", `/api/maap-entries/${id}`, { note: "Rain delay", reason: "Added a note" })).body.data.note).toBe("Rain delay");
    const same = await asOwner("patch", `/api/maap-entries/${id}`, { numberOfMaaps: 10, reason: "No change" });
    expect(same.status).toBe(200);
    expect(same.body.data.revision).toBe(2);
  });

  it("moves an entry to a free date, keeping its rate; refuses an occupied, future or pre-joining date", async () => {
    const { w, id } = await setup();
    await save(daysAgo(2), [row(w, 8)], { reason: "Late entry" });
    expect((await asOwner("patch", `/api/maap-entries/${id}`, { date: daysAgo(2), reason: "Wrong day" })).status).toBe(409);
    expect((await asOwner("patch", `/api/maap-entries/${id}`, { date: addDays(today, 1), reason: "Wrong day" })).status).toBe(400);
    expect((await asOwner("patch", `/api/maap-entries/${id}`, { date: daysAgo(40), reason: "Wrong day" })).status).toBe(400);
    const moved = await asOwner("patch", `/api/maap-entries/${id}`, { date: daysAgo(3), reason: "Wrong day" });
    expect(moved.status).toBe(200);
    expect(moved.body.data).toMatchObject({ date: daysAgo(3), ratePerFourMaaps: 250, earnings: 625 });
    expect(moved.body.data.history[0].before.date).toBe(daysAgo(4));
  });

  it("404 for an unknown entry, 400 for a malformed id", async () => {
    expect((await asOwner("patch", "/api/maap-entries/aaaaaaaaaaaaaaaaaaaaaaaa", { numberOfMaaps: 5, reason: "Fix it" })).status).toBe(404);
    expect((await asOwner("patch", "/api/maap-entries/not-an-id", { numberOfMaaps: 5, reason: "Fix it" })).status).toBe(400);
    expect((await asOwner("get", "/api/maap-entries/aaaaaaaaaaaaaaaaaaaaaaaa")).status).toBe(404);
  });

  it("a correction racing another is a 409, not a silent overwrite", async () => {
    const { id } = await setup();
    db.beforeMaapUpdate = () => {
      db.beforeMaapUpdate = null;
      const row = db.maap.get(id);
      row.numberOfMaaps = 33;
      row.revision += 1;
    };
    expect((await asOwner("patch", `/api/maap-entries/${id}`, { numberOfMaaps: 5, reason: "Fix it" })).status).toBe(409);
    expect(db.maap.get(id).numberOfMaaps).toBe(33);
  });
});

describe("deleting an entry (soft)", () => {
  it("keeps the entry with who, when and why, and leaves it out of lists and totals", async () => {
    const [a, b] = [await maapvali(), await maapvali()];
    await save(today, [row(a, 10), row(b, 20)]);
    const id = (await entryFor(a, today)).id;

    const res = await asOwner("delete", `/api/maap-entries/${id}`, { reason: "Entered for the wrong worker" });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data).toMatchObject({ isDeleted: true, deletedReason: "Entered for the wrong worker", deletedBy: "Ramesh Patel", numberOfMaaps: 10 });

    const day = (await asOwner("get", `/api/maap-entries?date=${today}`)).body.data;
    expect(day.items.map((i) => i.labourId)).toEqual([b.id]);
    expect(day.summary).toMatchObject({ entries: 1, maaps: 20 });
    const withDeleted = (await asOwner("get", `/api/maap-entries?date=${today}&includeDeleted=true`)).body.data;
    expect(withDeleted.items).toHaveLength(2);
    expect(withDeleted.summary).toMatchObject({ entries: 1, maaps: 20 }); // voided entries are never in a total
    expect(db.maap.get(id)).toBeDefined(); // still in the database
  });

  it("needs a reason, cannot be repeated, and cannot be corrected afterwards", async () => {
    const w = await maapvali();
    await save(today, [row(w, 10)]);
    const id = (await entryFor(w, today)).id;
    expect((await asOwner("delete", `/api/maap-entries/${id}`, {})).status).toBe(400);
    expect((await asOwner("delete", `/api/maap-entries/${id}`, { reason: "no" })).status).toBe(400);
    expect((await asOwner("delete", `/api/maap-entries/${id}`, { reason: "Wrong day", extra: 1 })).status).toBe(400);
    expect((await asOwner("delete", `/api/maap-entries/${id}`, { reason: "Wrong day" })).status).toBe(200);
    expect((await asOwner("delete", `/api/maap-entries/${id}`, { reason: "Wrong day" })).status).toBe(409);
    expect((await asOwner("patch", `/api/maap-entries/${id}`, { numberOfMaaps: 5, reason: "Fix it" })).status).toBe(409);
  });

  it("frees the slot: a new entry can be made for that worker and day, and only it counts", async () => {
    const w = await maapvali();
    await save(today, [row(w, 10)]);
    const oldId = (await entryFor(w, today)).id;
    await asOwner("delete", `/api/maap-entries/${oldId}`, { reason: "Wrong count" });
    const res = await save(today, [row(w, 12)]);
    expect(res.body.data.saved).toEqual({ created: 1, updated: 0, unchanged: 0 });
    expect(res.body.data.items).toHaveLength(1);
    expect(res.body.data.items[0].id).not.toBe(oldId);
    expect([...db.maap.values()].filter((r) => r.labourId === w.id)).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
describe("historical queries", () => {
  const seed = async () => {
    const [a, b] = [await maapvali(), await maapvali()];
    await save(daysAgo(4), [row(a, 40), row(b, 4)], { reason: "Late entry" });
    await save(daysAgo(3), [row(a, 41), row(b, 5)], { reason: "Late entry" });
    await save(daysAgo(2), [row(a, 1)], { reason: "Late entry" });
    return { a, b };
  };

  it("lists a date range newest first, paged, with totals over everything that matches", async () => {
    await seed();
    const res = await asOwner("get", `/api/maap-entries?from=${daysAgo(4)}&to=${daysAgo(2)}&limit=3`);
    expect(res.body.meta).toMatchObject({ page: 1, limit: 3, total: 5, summary: { entries: 5, maaps: 91, earnings: 5687.5 } });
    expect(res.body.data.map((r) => [r.date, r.labourId])).toEqual([[daysAgo(2), "L-001"], [daysAgo(3), "L-001"], [daysAgo(3), "L-002"]]);
    expect((await asOwner("get", `/api/maap-entries?from=${daysAgo(4)}&to=${daysAgo(2)}&limit=3&page=2`)).body.data).toHaveLength(2);
  });

  it("narrows by worker and supports open-ended ranges", async () => {
    const { a } = await seed();
    const forA = await asOwner("get", `/api/maap-entries?from=${daysAgo(10)}&labourId=${a.id}`);
    expect(forA.body.data.map((r) => r.numberOfMaaps)).toEqual([1, 41, 40]);
    expect((await asOwner("get", `/api/maap-entries?to=${daysAgo(3)}`)).body.meta.total).toBe(4);
  });

  it("returns a worker's whole history newest first, with totals, honouring a date range", async () => {
    const { a } = await seed();
    const res = await asOwner("get", `/api/labours/${a.id}/maap-entries`);
    expect(res.body.data.map((e) => [e.date, e.numberOfMaaps, e.earnings])).toEqual([[daysAgo(2), 1, 62.5], [daysAgo(3), 41, 2562.5], [daysAgo(4), 40, 2500]]);
    expect(res.body.meta.summary).toEqual({ entries: 3, maaps: 82, earnings: 5125, estimatedBricks: 22550 });
    const ranged = await asOwner("get", `/api/labours/${a.id}/maap-entries?from=${daysAgo(3)}`);
    expect(ranged.body.data).toHaveLength(2);
  });

  it("keeps old days after later saves, corrections and deletions", async () => {
    const { a } = await seed();
    await save(today, [row(a, 9)]);
    const id = (await entryFor(a, daysAgo(4))).id;
    await asOwner("patch", `/api/maap-entries/${id}`, { numberOfMaaps: 44, reason: "Miscounted" });
    const history = (await asOwner("get", `/api/labours/${a.id}/maap-entries?includeDeleted=true`)).body.data;
    expect(history).toHaveLength(4);
    expect((await asOwner("get", `/api/maap-entries/${id}`)).body.data.history).toHaveLength(1);
  });

  it("is empty for a labour who is not Maapvali, 404 for unknown labour, and validates the query", async () => {
    const bigari = await makeLabour("BIGARI");
    expect((await asOwner("get", `/api/labours/${bigari.id}/maap-entries`)).body.data).toEqual([]);
    expect((await asOwner("get", "/api/labours/L-999/maap-entries")).status).toBe(404);
    expect((await asOwner("get", "/api/labours/nope/maap-entries")).status).toBe(400);
    for (const qs of ["", `date=${today}&from=${today}`, `from=${today}&to=${daysAgo(3)}`, "date=2026-02-30", "limit=9999", "foo=1", `date=${today}&includeDeleted=maybe`]) {
      expect((await asOwner("get", `/api/maap-entries?${qs}`)).status, qs).toBe(400);
    }
  });

  it("an empty day is an empty list, not an error", async () => {
    const res = await asOwner("get", `/api/maap-entries?date=${today}`);
    expect(res.body.data).toMatchObject({ items: [], summary: { entries: 0, maaps: 0, earnings: 0, estimatedBricks: 0 } });
  });
});

// ---------------------------------------------------------------------------
describe("Maapvali work is separate from payments, attendance and other records", () => {
  it("saving, correcting and deleting change nothing outside the maap entries", async () => {
    const w = await maapvali();
    const snapshot = () => JSON.stringify([[...db.labours.values()], db.rates, [...db.attendance.values()]]);
    const before = snapshot();
    await save(today, [row(w, 10)]);
    const id = (await entryFor(w, today)).id;
    await asOwner("patch", `/api/maap-entries/${id}`, { numberOfMaaps: 12, reason: "Miscounted" });
    await asOwner("delete", `/api/maap-entries/${id}`, { reason: "Wrong day" });
    expect(snapshot()).toBe(before);
  });

  it("no Maapvali work module reads or writes anything payment-related", () => {
    for (const file of ["services/maapEntry.service.js", "services/maapCalculations.js", "controllers/maapEntry.controller.js", "routes/maapEntry.routes.js", "models/MaapEntry.js", "validators/maapEntry.validators.js"]) {
      const imports = readFileSync(new URL(`../${file}`, import.meta.url), "utf8").split("\n").filter((line) => /^\s*import\b/.test(line)).join("\n").toLowerCase();
      expect(imports, file).not.toContain("payment");
      expect(imports, file).not.toContain("salary");
      expect(imports, file).not.toContain("attendance");
    }
  });

  it("the stored entry holds no payment fields", async () => {
    const w = await maapvali();
    await save(today, [row(w, 10)]);
    for (const field of ["paid", "amountPaid", "balance", "payment", "attendance"]) expect(liveRows(today)[0]).not.toHaveProperty(field);
  });
});

describe("model", () => {
  const valid = { labourId: "L-001", date: "2026-11-01", numberOfMaaps: 10, ratePaise: 25000, earningsPaise: 62500 };
  const errorsOf = (data) => new RealMaapEntry(data).validateSync()?.errors ?? {};

  it("accepts a valid entry with sensible defaults", () => {
    const doc = new RealMaapEntry(valid);
    expect(doc.validateSync()).toBeUndefined();
    expect(doc).toMatchObject({ revision: 1, isDeleted: false, note: "" });
  });

  it("rejects bad maaps, rates, ids and dates, and drops unknown fields", () => {
    for (const numberOfMaaps of [-1, 1.5, 10000]) expect(errorsOf({ ...valid, numberOfMaaps }).numberOfMaaps, String(numberOfMaaps)).toBeDefined();
    expect(errorsOf({ ...valid, ratePaise: 0 }).ratePaise).toBeDefined();
    expect(errorsOf({ ...valid, ratePaise: 250.5 }).ratePaise).toBeDefined();
    expect(errorsOf({ ...valid, earningsPaise: -1 }).earningsPaise).toBeDefined();
    expect(errorsOf({ ...valid, labourId: "X-1" }).labourId).toBeDefined();
    expect(errorsOf({ ...valid, date: "2026-02-30" }).date).toBeDefined();
    expect(errorsOf({})).toHaveProperty("labourId");
    expect(new RealMaapEntry({ ...valid, amountPaid: 500 }).get("amountPaid")).toBeUndefined();
  });
});
