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
const { db, makeAttendanceModel, makeCounterModel, makeLabourModel, makeRateModel } = await import("./helpers/memoryDb.js");
const users = vi.hoisted(() => ({ list: [] }));

vi.mock("../config/db.js", () => ({ getDbStatus: async () => ({ status: "connected", name: "test" }) }));
vi.mock("../models/User.js", () => ({
  default: { findById: (id) => ({ lean: async () => users.list.find((u) => String(u._id) === String(id)) ?? null }) },
}));
vi.mock("../models/Counter.js", () => ({ default: makeCounterModel() }));
vi.mock("../models/Labour.js", async (importOriginal) => ({ default: makeLabourModel((await importOriginal()).default) }));
vi.mock("../models/LabourRateHistory.js", async (importOriginal) => ({ default: makeRateModel((await importOriginal()).default) }));
vi.mock("../models/Attendance.js", () => ({ default: makeAttendanceModel() }));

const { createApp } = await import("../app.js");
const { signAccessToken } = await import("../services/auth.service.js");
const { earnedPaiseFor } = await import("../services/attendance.service.js");
const { addDays, todayBusinessDate } = await import("../utils/dates.js");
const RealAttendance = (await vi.importActual("../models/Attendance.js")).default;

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
const mobile = () => `98000${String(10000 + (mobileSeq += 1))}`;
const makeLabour = async (labourType, o = {}) => {
  const rate = { BIGARI: { dailyRate: 650 }, MAAPVALI: { ratePerFourMaaps: 88 }, PATLAVALE: { ratePer1000PayableBricks: 650 } }[labourType];
  const res = await asOwner("post", "/api/labours", { labourType, name: `Worker ${mobileSeq + 1}`, mobile: mobile(), village: "Sinnar", joiningDate: daysAgo(60), ...rate, ...o });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.data;
};
const bigari = (o) => makeLabour("BIGARI", o);

const save = (date, entries, extra = {}) => asOwner("put", `/api/attendance/${date}`, { entries, ...extra });
const entry = (labour, status) => ({ labourId: labour.id, status });
const rowsOf = (date) => [...db.attendance.values()].filter((r) => r.date === date);

beforeEach(() => {
  today = todayBusinessDate();
  db.reset();
  db.beforeAttendanceUpdate = null;
  users.list.length = 0;
  mobileSeq = 0;
  owner = addUser("OWNER");
  manager = addUser("MANAGER", "Helper");
  app = createApp();
});
afterEach(() => vi.useRealTimers());

// ---------------------------------------------------------------------------
describe("access", () => {
  it("needs a login for every attendance route", async () => {
    for (const [method, url] of [
      ["get", `/api/attendance?date=${today}`],
      ["put", `/api/attendance/${today}`],
      ["get", `/api/attendance/${today}/L-001`],
      ["get", "/api/labours/L-001/attendance"],
    ]) {
      expect((await send(method, url, null, method === "put" ? {} : undefined)).status, `${method} ${url}`).toBe(401);
    }
  });

  it("lets a non-owner read but not save, and has no delete", async () => {
    const a = await bigari();
    await save(today, [entry(a, "PRESENT")]);
    expect((await send("get", `/api/attendance?date=${today}`, manager.cookie)).status).toBe(200);
    expect((await send("put", `/api/attendance/${today}`, manager.cookie, { entries: [entry(a, "ABSENT")] })).status).toBe(403);
    expect((await asOwner("delete", `/api/attendance/${today}/${a.id}`)).status).toBe(404);
    expect(rowsOf(today)[0].status).toBe("PRESENT");
  });
});

// ---------------------------------------------------------------------------
describe("saving and retrieving a day", () => {
  it("saves the three statuses and reads them back with the day's counts", async () => {
    const [a, b, c] = [await bigari(), await bigari(), await bigari()];
    const res = await save(today, [entry(a, "PRESENT"), entry(b, "HALF_DAY"), entry(c, "ABSENT")]);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.saved).toEqual({ created: 3, updated: 0, unchanged: 0 });
    expect(res.body.data.summary).toEqual({ total: 3, present: 1, halfDay: 1, absent: 1, units: 1.5 });

    const day = (await asOwner("get", `/api/attendance?date=${today}`)).body.data;
    expect(day.date).toBe(today);
    expect(day.items.map((i) => [i.labourId, i.status])).toEqual([["L-001", "PRESENT"], ["L-002", "HALF_DAY"], ["L-003", "ABSENT"]]);
    expect(day.items[0]).toMatchObject({ revision: 1, corrected: false });
    expect(day.summary).toEqual({ total: 3, present: 1, halfDay: 1, absent: 1, units: 1.5 });
  });

  it("stores only the status: half-day and absent are values, not numbers or flags", async () => {
    const a = await bigari();
    await save(today, [entry(a, "HALF_DAY")]);
    const row = rowsOf(today)[0];
    expect(row).toMatchObject({ labourId: a.id, date: today, status: "HALF_DAY", revision: 1, history: [] });
    for (const money of ["rate", "ratePaise", "earned", "amount", "payment"]) expect(row).not.toHaveProperty(money);
  });

  it("returns an empty day, not an error, when nothing is saved", async () => {
    const res = await asOwner("get", `/api/attendance?date=${today}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ items: [], summary: { total: 0, present: 0, halfDay: 0, absent: 0, units: 0 } });
  });

  it("saves only the workers sent (unmarked workers get no record)", async () => {
    const a = await bigari();
    await bigari();
    await save(today, [entry(a, "PRESENT")]);
    expect(rowsOf(today)).toHaveLength(1);
  });

  it("keeps days apart: saving one day never touches another", async () => {
    const a = await bigari();
    await save(daysAgo(2), [entry(a, "PRESENT")]);
    await save(daysAgo(1), [entry(a, "ABSENT")]);
    expect((await asOwner("get", `/api/attendance?date=${daysAgo(2)}`)).body.data.items[0].status).toBe("PRESENT");
    expect((await asOwner("get", `/api/attendance?date=${daysAgo(1)}`)).body.data.items[0].status).toBe("ABSENT");
  });
});

describe("request validation", () => {
  it("rejects bad statuses, ids and shapes", async () => {
    const a = await bigari();
    const bad = async (body, field) => {
      const res = await asOwner("put", `/api/attendance/${today}`, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      if (field) expect(res.body.errors.map((e) => e.field)).toContain(field);
      expect(db.attendance.size).toBe(0);
    };
    await bad({ entries: [{ labourId: a.id, status: "present" }] }, "entries.0.status");
    await bad({ entries: [{ labourId: a.id, status: "LEAVE" }] }, "entries.0.status");
    await bad({ entries: [{ labourId: a.id }] }, "entries.0.status");
    await bad({ entries: [{ labourId: "nope", status: "PRESENT" }] }, "entries.0.labourId");
    await bad({ entries: [{ labourId: { $ne: "" }, status: "PRESENT" }] });
    await bad({ entries: [] });
    await bad({});
    await bad({ entries: [{ ...entry(a, "PRESENT"), date: "2020-01-01" }] }); // unknown field
    await bad({ entries: [entry(a, "PRESENT")], id: "x" }); // unknown field
    await bad({ entries: [entry(a, "PRESENT")], reason: "ab" }, "reason");
    await bad({ entries: Array.from({ length: 501 }, () => entry(a, "PRESENT")) });
  });

  it("rejects the same labour twice in one request", async () => {
    const a = await bigari();
    const res = await save(today, [entry(a, "PRESENT"), entry(a, "ABSENT")]);
    expect(res.status).toBe(400);
    expect(res.body.errors[0].field).toBe("entries.1.labourId");
    expect(db.attendance.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
describe("the duplicate rule: one record per labour per date", () => {
  it("is enforced by a unique index on (labourId, date)", () => {
    expect(RealAttendance.schema.indexes().some(([f, o]) => f.labourId === 1 && f.date === 1 && o.unique)).toBe(true);
    expect(RealAttendance.schema.path("labourId").options.immutable).toBe(true);
    expect(RealAttendance.schema.path("date").options.immutable).toBe(true);
  });

  it("saving the same day again creates no second record and no new revision", async () => {
    const a = await bigari();
    await save(today, [entry(a, "PRESENT")]);
    const again = await save(today, [entry(a, "PRESENT")]);
    expect(again.body.data.saved).toEqual({ created: 0, updated: 0, unchanged: 1 });
    expect(rowsOf(today)).toHaveLength(1);
    expect(rowsOf(today)[0]).toMatchObject({ revision: 1, history: [] });
  });

  it("a different status corrects the same record and keeps what it replaced", async () => {
    const a = await bigari();
    await save(today, [entry(a, "PRESENT")]);
    const res = await save(today, [entry(a, "HALF_DAY")], { reason: "Left at noon" });
    expect(res.body.data.saved).toEqual({ created: 0, updated: 1, unchanged: 0 });
    expect(rowsOf(today)).toHaveLength(1);
    expect(res.body.data.items[0]).toMatchObject({ status: "HALF_DAY", revision: 2, corrected: true });

    const detail = (await asOwner("get", `/api/attendance/${today}/${a.id}`)).body.data;
    expect(detail.history).toEqual([expect.objectContaining({ from: "PRESENT", to: "HALF_DAY", by: "Ramesh Patel", reason: "Left at noon" })]);
    expect(typeof detail.history[0].at).toBe("string");
  });

  it("keeps the whole trail across several corrections, and the reason is optional", async () => {
    const a = await bigari();
    await save(today, [entry(a, "PRESENT")]);
    await save(today, [entry(a, "ABSENT")]);
    await save(today, [entry(a, "HALF_DAY")], { reason: "Checked the register" });
    await save(today, [entry(a, "PRESENT")]);
    const detail = (await asOwner("get", `/api/attendance/${today}/${a.id}`)).body.data;
    expect(detail.revision).toBe(4);
    expect(detail.history.map((h) => [h.from, h.to, h.reason])).toEqual([["PRESENT", "ABSENT", null], ["ABSENT", "HALF_DAY", "Checked the register"], ["HALF_DAY", "PRESENT", null]]);
  });

  it("a mixed save counts created, corrected and unchanged separately", async () => {
    const [a, b, c] = [await bigari(), await bigari(), await bigari()];
    await save(today, [entry(a, "PRESENT"), entry(b, "PRESENT")]);
    const res = await save(today, [entry(a, "PRESENT"), entry(b, "ABSENT"), entry(c, "HALF_DAY")]);
    expect(res.body.data.saved).toEqual({ created: 1, updated: 1, unchanged: 1 });
    expect(rowsOf(today)).toHaveLength(3);
  });

  it("a record created by someone else mid-save ends as a 409, never a duplicate", async () => {
    const a = await bigari();
    db.beforeAttendanceUpdate = () => {
      db.beforeAttendanceUpdate = null;
      db.attendance.set(`${a.id}|${today}`, { _id: "att-x", labourId: a.id, date: today, status: "ABSENT", revision: 1, history: [] });
    };
    const res = await save(today, [entry(a, "PRESENT")]);
    expect(res.status).toBe(409);
    expect(res.body.errors[0].field).toBe("entries.0.labourId");
    expect(rowsOf(today)).toHaveLength(1);
    expect(rowsOf(today)[0].status).toBe("ABSENT"); // the other writer's value is not overwritten
  });

  it("a duplicate-key error from the database is also a 409", async () => {
    const a = await bigari();
    db.failNextAttendanceWrite = "duplicate";
    const res = await save(today, [entry(a, "PRESENT")]);
    expect(res.status).toBe(409);
    expect(db.attendance.size).toBe(0);
  });

  it("a record corrected by someone else mid-save is not overwritten unseen; the rest is saved and a retry is safe", async () => {
    const [a, b] = [await bigari(), await bigari()];
    await save(today, [entry(a, "PRESENT"), entry(b, "PRESENT")]);
    db.beforeAttendanceUpdate = (filter) => {
      if (filter.labourId !== a.id) return;
      db.beforeAttendanceUpdate = null;
      db.attendance.get(`${a.id}|${today}`).status = "HALF_DAY"; // someone else corrected A first
    };
    const res = await save(today, [entry(a, "ABSENT"), entry(b, "ABSENT")]);
    expect(res.status).toBe(409);
    expect(res.body.errors.map((e) => e.field)).toEqual(["entries.0.labourId"]);
    expect(db.attendance.get(`${a.id}|${today}`).status).toBe("HALF_DAY");
    expect(db.attendance.get(`${b.id}|${today}`).status).toBe("ABSENT");

    const retry = await save(today, [entry(a, "ABSENT"), entry(b, "ABSENT")]);
    expect(retry.status).toBe(200);
    expect(retry.body.data.saved).toEqual({ created: 0, updated: 1, unchanged: 1 });
  });
});

// ---------------------------------------------------------------------------
describe("who can have attendance", () => {
  it("rejects the whole request when any entry is invalid, and writes nothing", async () => {
    const good = await bigari();
    const maap = await makeLabour("MAAPVALI");
    const res = await save(today, [entry(good, "PRESENT"), entry(maap, "PRESENT")]);
    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual([{ field: "entries.1.labourId", message: "Attendance is only for Bigari workers" }]);
    expect(db.attendance.size).toBe(0);
  });

  it("refuses Patlavale teams and unknown labour", async () => {
    const team = await makeLabour("PATLAVALE");
    expect((await save(today, [entry(team, "PRESENT")])).status).toBe(400);
    const unknown = await save(today, [{ labourId: "L-999", status: "PRESENT" }]);
    expect(unknown.status).toBe(400);
    expect(unknown.body.errors[0].message).toBe("Labour not found");
  });

  it("refuses a date before the worker joined, and allows the joining day itself", async () => {
    const a = await bigari({ joiningDate: daysAgo(5) });
    const early = await save(daysAgo(6), [entry(a, "PRESENT")]);
    expect(early.status).toBe(400);
    expect(early.body.errors[0].message).toContain("after this date");
    expect((await save(daysAgo(5), [entry(a, "PRESENT")])).status).toBe(200);
  });

  it("refuses a new record for an inactive worker, but old days stay correctable", async () => {
    const a = await bigari();
    await save(daysAgo(3), [entry(a, "PRESENT")]);
    await asOwner("patch", `/api/labours/${a.id}`, { status: "INACTIVE", statusReason: "Left the job" });

    const fresh = await save(daysAgo(2), [entry(a, "PRESENT")]);
    expect(fresh.status).toBe(400);
    expect(fresh.body.errors[0].message).toContain("inactive");

    const fix = await save(daysAgo(3), [entry(a, "ABSENT")], { reason: "Was on leave" });
    expect(fix.status).toBe(200);
    expect(fix.body.data.items[0]).toMatchObject({ status: "ABSENT", revision: 2 });
  });
});

// ---------------------------------------------------------------------------
describe("business dates (IST)", () => {
  it("rejects a future date and a malformed or impossible one", async () => {
    const a = await bigari();
    const future = await save(addDays(today, 1), [entry(a, "PRESENT")]);
    expect(future.status).toBe(400);
    expect(future.body.errors[0].field).toBe("date");
    for (const bad of ["2026-02-30", "2026-13-01", "01-11-2026", "2026-1-5", "yesterday"]) {
      expect((await save(bad, [entry(a, "PRESENT")])).status, bad).toBe(400);
    }
    expect(db.attendance.size).toBe(0);
  });

  it("uses the Indian day, not the UTC day, to decide what is 'future'", async () => {
    const a = await bigari();
    vi.useFakeTimers({ toFake: ["Date"] });

    // 23:45 on 2 Nov in India (18:15 UTC): 3 Nov has not started yet.
    vi.setSystemTime(new Date("2026-11-02T18:15:00Z"));
    owner = addUser("OWNER");
    expect((await save("2026-11-03", [entry(a, "PRESENT")])).status).toBe(400);
    expect((await save("2026-11-02", [entry(a, "PRESENT")])).status).toBe(200);

    // 00:15 on 3 Nov in India (18:45 UTC the day before): it is now 3 Nov, though UTC still says 2 Nov.
    vi.setSystemTime(new Date("2026-11-02T18:45:00Z"));
    owner = addUser("OWNER");
    expect((await save("2026-11-03", [entry(a, "PRESENT")])).status).toBe(200);
    expect((await save("2026-11-04", [entry(a, "PRESENT")])).status).toBe(400);
    expect(rowsOf("2026-11-03")).toHaveLength(1);
  });

  it("stores the date exactly as sent, as a plain string", async () => {
    const a = await bigari();
    await save("2026-10-31", [entry(a, "PRESENT")]);
    expect(rowsOf("2026-10-31")[0].date).toBe("2026-10-31");
    expect(typeof rowsOf("2026-10-31")[0].date).toBe("string");
  });

  it("a leap day is a real date", async () => {
    const a = await bigari({ joiningDate: "2024-01-01" });
    expect((await save("2024-02-29", [entry(a, "PRESENT")])).status).toBe(200);
    expect((await save("2025-02-29", [entry(a, "PRESENT")])).status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
describe("historical queries", () => {
  const seed = async () => {
    const [a, b] = [await bigari(), await bigari()];
    await save(daysAgo(4), [entry(a, "PRESENT"), entry(b, "ABSENT")]);
    await save(daysAgo(3), [entry(a, "HALF_DAY"), entry(b, "PRESENT")]);
    await save(daysAgo(2), [entry(a, "PRESENT")]);
    return { a, b };
  };

  it("lists a date range newest first with paging", async () => {
    await seed();
    const res = await asOwner("get", `/api/attendance?from=${daysAgo(4)}&to=${daysAgo(2)}&limit=3`);
    expect(res.body.meta).toEqual({ page: 1, limit: 3, total: 5 });
    expect(res.body.data.map((r) => [r.date, r.labourId])).toEqual([[daysAgo(2), "L-001"], [daysAgo(3), "L-001"], [daysAgo(3), "L-002"]]);
    const page2 = await asOwner("get", `/api/attendance?from=${daysAgo(4)}&to=${daysAgo(2)}&limit=3&page=2`);
    expect(page2.body.data).toHaveLength(2);
  });

  it("narrows by labour and by status, and supports open-ended ranges", async () => {
    const { a } = await seed();
    const forA = await asOwner("get", `/api/attendance?from=${daysAgo(10)}&labourId=${a.id}`);
    expect(forA.body.data.map((r) => r.status)).toEqual(["PRESENT", "HALF_DAY", "PRESENT"]);
    const absent = await asOwner("get", `/api/attendance?to=${today}&status=ABSENT`);
    expect(absent.body.data.map((r) => r.labourId)).toEqual(["L-002"]);
  });

  it("rejects a query with no date, with both forms, or with an inverted range", async () => {
    for (const qs of ["", `date=${today}&from=${today}`, `from=${today}&to=${daysAgo(3)}`, "date=2026-02-30", "status=LEAVE", "limit=9999", "foo=1"]) {
      expect((await asOwner("get", `/api/attendance?${qs}`)).status, qs).toBe(400);
    }
  });

  it("returns one record with its trail, and 404 when there is none", async () => {
    const { a } = await seed();
    expect((await asOwner("get", `/api/attendance/${daysAgo(3)}/${a.id}`)).body.data).toMatchObject({ status: "HALF_DAY", history: [] });
    expect((await asOwner("get", `/api/attendance/${today}/${a.id}`)).status).toBe(404);
    expect((await asOwner("get", `/api/attendance/${today}/bad-id`)).status).toBe(400);
  });

  it("old days remain after later saves and corrections", async () => {
    const { a } = await seed();
    await save(today, [entry(a, "ABSENT")]);
    await save(daysAgo(4), [entry(a, "HALF_DAY")]);
    expect((await asOwner("get", `/api/attendance?from=${daysAgo(10)}&to=${today}`)).body.meta.total).toBe(6);
  });
});

describe("a worker's history with earnings", () => {
  it("prices each day at the rate in force that day, rounded half up once per day", async () => {
    const a = await bigari({ dailyRate: 650.01, joiningDate: daysAgo(60) });
    await asOwner("post", `/api/labours/${a.id}/rates`, { newRate: 700, effectiveFrom: daysAgo(10), reason: "Yearly increase" });
    await save(daysAgo(20), [entry(a, "PRESENT")]);
    await save(daysAgo(19), [entry(a, "HALF_DAY")]);
    await save(daysAgo(18), [entry(a, "ABSENT")]);
    await save(daysAgo(5), [entry(a, "PRESENT")]);
    await save(daysAgo(4), [entry(a, "HALF_DAY")]);

    const res = await asOwner("get", `/api/labours/${a.id}/attendance`);
    expect(res.status).toBe(200);
    expect(res.body.data.map((r) => [r.date, r.status, r.units, r.rate, r.earned])).toEqual([
      [daysAgo(4), "HALF_DAY", 0.5, 700, 350],
      [daysAgo(5), "PRESENT", 1, 700, 700],
      [daysAgo(18), "ABSENT", 0, 650.01, 0],
      [daysAgo(19), "HALF_DAY", 0.5, 650.01, 325.01], // 65001 paise / 2 = 32500.5 -> 32501
      [daysAgo(20), "PRESENT", 1, 650.01, 650.01],
    ]);
    expect(res.body.meta).toEqual({ total: 5, present: 2, halfDay: 2, absent: 1, units: 3 });
  });

  it("a later rate change never alters an earlier day", async () => {
    const a = await bigari({ joiningDate: daysAgo(60) });
    await save(daysAgo(20), [entry(a, "PRESENT")]);
    const before = (await asOwner("get", `/api/labours/${a.id}/attendance`)).body.data[0];
    await asOwner("post", `/api/labours/${a.id}/rates`, { newRate: 900, effectiveFrom: daysAgo(5), reason: "Raise" });
    const after = (await asOwner("get", `/api/labours/${a.id}/attendance`)).body.data[0];
    expect(after.earned).toBe(before.earned);
    expect(after.rate).toBe(650);
  });

  it("filters by date range, and is empty for non-Bigari labour", async () => {
    const a = await bigari();
    await save(daysAgo(9), [entry(a, "PRESENT")]);
    await save(daysAgo(2), [entry(a, "PRESENT")]);
    const ranged = await asOwner("get", `/api/labours/${a.id}/attendance?from=${daysAgo(5)}`);
    expect(ranged.body.data.map((r) => r.date)).toEqual([daysAgo(2)]);
    const maap = await makeLabour("MAAPVALI");
    expect((await asOwner("get", `/api/labours/${maap.id}/attendance`)).body.data).toEqual([]);
    expect((await asOwner("get", "/api/labours/L-999/attendance")).status).toBe(404);
    expect((await asOwner("get", "/api/labours/nope/attendance")).status).toBe(400);
  });

  it("earnedPaiseFor: full, half (rounded half up) and none", () => {
    expect(earnedPaiseFor("PRESENT", 65000)).toBe(65000);
    expect(earnedPaiseFor("HALF_DAY", 65000)).toBe(32500);
    expect(earnedPaiseFor("HALF_DAY", 65001)).toBe(32501);
    expect(earnedPaiseFor("HALF_DAY", 65003)).toBe(32502);
    expect(earnedPaiseFor("ABSENT", 65000)).toBe(0);
    expect(earnedPaiseFor("PRESENT", null)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
describe("attendance is separate from payments and from other records", () => {
  it("saving attendance changes nothing outside the attendance collection", async () => {
    const a = await bigari();
    const labours = JSON.stringify([...db.labours.values()]);
    const rates = JSON.stringify(db.rates);
    await save(today, [entry(a, "PRESENT")]);
    await save(today, [entry(a, "ABSENT")], { reason: "Correction" });
    expect(JSON.stringify([...db.labours.values()])).toBe(labours);
    expect(JSON.stringify(db.rates)).toBe(rates);
  });

  it("no attendance module reads or writes anything payment-related", () => {
    for (const file of ["services/attendance.service.js", "controllers/attendance.controller.js", "routes/attendance.routes.js", "models/Attendance.js", "validators/attendance.validators.js"]) {
      const imports = readFileSync(new URL(`../${file}`, import.meta.url), "utf8").split("\n").filter((line) => /^\s*import\b/.test(line)).join("\n");
      expect(imports.toLowerCase(), file).not.toContain("payment");
      expect(imports.toLowerCase(), file).not.toContain("salary");
    }
  });
});

describe("model", () => {
  const valid = { labourId: "L-001", date: "2026-11-01", status: "PRESENT" };
  const errorsOf = (data) => new RealAttendance(data).validateSync()?.errors ?? {};

  it("accepts a valid record with sensible defaults", () => {
    const doc = new RealAttendance(valid);
    expect(doc.validateSync()).toBeUndefined();
    expect(doc.revision).toBe(1);
    expect(doc.history).toHaveLength(0);
  });

  it("rejects a bad status, labour id or date, and drops unknown fields", () => {
    expect(errorsOf({ ...valid, status: "LEAVE" }).status).toBeDefined();
    expect(errorsOf({ ...valid, labourId: "X-1" }).labourId).toBeDefined();
    expect(errorsOf({ ...valid, date: "2026-02-30" }).date).toBeDefined();
    expect(errorsOf({})).toHaveProperty("labourId");
    expect(new RealAttendance({ ...valid, amountPaid: 500 }).get("amountPaid")).toBeUndefined();
  });
});
