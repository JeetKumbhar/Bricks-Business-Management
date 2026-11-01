import mongoose from "mongoose";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.NODE_ENV = "test";
  process.env.BCRYPT_ROUNDS = "4";
  process.env.CLIENT_ORIGIN = "http://localhost:5173";
  process.env.JWT_SECRET = "unit-test-secret-that-is-long-enough-0123456789";
});

// No database in tests: the real Mongoose models do validation; an in-memory store replaces only the storage calls.
const { db, makeCounterModel, makeLabourModel, makeRateModel } = await import("./helpers/memoryDb.js");
const users = vi.hoisted(() => ({ list: [] }));

vi.mock("../config/db.js", () => ({ getDbStatus: async () => ({ status: "connected", name: "test" }) }));
vi.mock("../models/User.js", () => ({
  default: { findById: (id) => ({ lean: async () => users.list.find((u) => String(u._id) === String(id)) ?? null }) },
}));
vi.mock("../models/Counter.js", () => ({ default: makeCounterModel() }));
vi.mock("../models/Labour.js", async (importOriginal) => ({ default: makeLabourModel((await importOriginal()).default) }));
vi.mock("../models/LabourRateHistory.js", async (importOriginal) => ({ default: makeRateModel((await importOriginal()).default) }));

const { createApp } = await import("../app.js");
const { signAccessToken } = await import("../services/auth.service.js");
const { ratePaiseAt, sortRatesAsc } = await import("../services/labourRates.js");
const { buildListFilter } = await import("../services/labour.service.js");
const { addDays, todayBusinessDate } = await import("../utils/dates.js");
const RealLabour = (await vi.importActual("../models/Labour.js")).default;
const RealRate = (await vi.importActual("../models/LabourRateHistory.js")).default;

const ORIGIN = "http://localhost:5173";
const today = todayBusinessDate();
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

const bigari = (o = {}) => ({ labourType: "BIGARI", name: "Ramesh Kumar", mobile: "9876543210", village: "Sinnar", joiningDate: daysAgo(30), dailyRate: 650, ...o });
const maapvali = (o = {}) => ({ labourType: "MAAPVALI", name: "Santosh More", mobile: "9876543211", village: "Dindori", joiningDate: daysAgo(30), ratePerFourMaaps: 88, ...o });
const patlavale = (o = {}) => ({
  labourType: "PATLAVALE",
  name: "Jadhav Family",
  mobile: "9876543212",
  village: "Niphad",
  joiningDate: daysAgo(30),
  ratePer1000PayableBricks: 650.5,
  members: [{ name: "Ganesh Jadhav", relation: "Head" }, { name: "Sita Jadhav", relation: "Wife" }],
  ...o,
});
const create = async (body) => {
  const res = await asOwner("post", "/api/labours", body);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.data;
};

beforeEach(() => {
  db.reset();
  users.list.length = 0;
  owner = addUser("OWNER");
  manager = addUser("MANAGER", "Helper");
  app = createApp();
});

// ---------------------------------------------------------------------------
describe("access", () => {
  it("needs a login for every labour route", async () => {
    for (const [method, url] of [["get", "/api/labours"], ["get", "/api/labours/summary"], ["get", "/api/labours/L-001"], ["post", "/api/labours"], ["patch", "/api/labours/L-001"], ["get", "/api/labours/L-001/rates"], ["post", "/api/labours/L-001/rates"]]) {
      expect((await send(method, url, null, method === "get" ? undefined : {})).status, `${method} ${url}`).toBe(401);
    }
  });

  it("lets a non-owner read but not change anything", async () => {
    const created = await create(bigari());
    expect((await send("get", "/api/labours", manager.cookie)).status).toBe(200);
    expect((await send("get", `/api/labours/${created.id}`, manager.cookie)).status).toBe(200);
    expect((await send("post", "/api/labours", manager.cookie, bigari({ mobile: "9000000001" }))).status).toBe(403);
    expect((await send("patch", `/api/labours/${created.id}`, manager.cookie, { village: "X" })).status).toBe(403);
    expect((await send("post", `/api/labours/${created.id}/rates`, manager.cookie, { newRate: 700, effectiveFrom: today, reason: "Raise" })).status).toBe(403);
  });

  it("has no delete: history is never erased", async () => {
    const created = await create(bigari());
    expect((await asOwner("delete", `/api/labours/${created.id}`)).status).toBe(404);
    expect((await asOwner("get", `/api/labours/${created.id}`)).status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
describe("creating each category", () => {
  it("creates a Bigari with only a daily rate", async () => {
    const l = await create(bigari());
    expect(l).toMatchObject({ id: "L-001", labourType: "BIGARI", name: "Ramesh Kumar", status: "ACTIVE", rateType: "DAILY_RATE", dailyRate: 650 });
    expect(l).not.toHaveProperty("ratePerFourMaaps");
    expect(l).not.toHaveProperty("ratePer1000PayableBricks");
    expect(l).not.toHaveProperty("members");
  });

  it("creates a Maapvali with only a rate per 4 maaps", async () => {
    const l = await create(maapvali());
    expect(l).toMatchObject({ labourType: "MAAPVALI", rateType: "RATE_PER_FOUR_MAAPS", ratePerFourMaaps: 88 });
    expect(l).not.toHaveProperty("dailyRate");
    expect(l).not.toHaveProperty("ratePer1000PayableBricks");
  });

  it("creates a Patlavale team with its rate, members and one salary account", async () => {
    const l = await create(patlavale());
    expect(l).toMatchObject({ labourType: "PATLAVALE", name: "Jadhav Family", rateType: "RATE_PER_1000_PAYABLE_BRICKS", ratePer1000PayableBricks: 650.5 });
    expect(l.members).toEqual([{ name: "Ganesh Jadhav", relation: "Head" }, { name: "Sita Jadhav", relation: "Wife" }]);
    expect(l).not.toHaveProperty("dailyRate");
  });

  it("gives ids in one shared sequence L-001, L-002, ...", async () => {
    const ids = [(await create(bigari())).id, (await create(maapvali())).id, (await create(patlavale())).id];
    expect(ids).toEqual(["L-001", "L-002", "L-003"]);
  });

  it("stores the rate as paise and starts the rate history with an Initial rate on the joining date", async () => {
    const l = await create(patlavale());
    expect(db.rates).toHaveLength(1);
    expect(db.rates[0]).toMatchObject({ labourId: l.id, rateType: "RATE_PER_1000_PAYABLE_BRICKS", ratePaise: 65050, effectiveFrom: l.joiningDate, reason: "Initial rate", changedBy: "Ramesh Patel" });
    expect(db.labours.get(l.id)).not.toHaveProperty("ratePaise");
  });

  it("records who created it and the first status entry", async () => {
    const l = await create(bigari());
    expect(l.statusHistory).toEqual([expect.objectContaining({ status: "ACTIVE", by: "Ramesh Patel", reason: "Created" })]);
  });

  it("can create an inactive record", async () => {
    expect((await create(bigari({ status: "INACTIVE" }))).status).toBe("INACTIVE");
  });
});

describe("create validation", () => {
  const bad = async (body, field) => {
    const res = await asOwner("post", "/api/labours", body);
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    if (field) expect(res.body.errors.map((e) => e.field)).toContain(field);
    expect(db.labours.size).toBe(0);
  };

  it("rejects a rate field that belongs to another type", async () => {
    await bad(maapvali({ ratePerFourMaaps: undefined, dailyRate: 650 }));
    await bad(bigari({ ratePer1000PayableBricks: 650 }));
    await bad(patlavale({ ratePerFourMaaps: 88 }));
  });

  it("rejects a missing or unknown type", async () => {
    await bad(bigari({ labourType: undefined }));
    await bad(bigari({ labourType: "DRIVER" }));
  });

  it("rejects bad rates", async () => {
    await bad(bigari({ dailyRate: 0 }), "dailyRate");
    await bad(bigari({ dailyRate: -5 }), "dailyRate");
    await bad(bigari({ dailyRate: "650" }), "dailyRate");
    await bad(bigari({ dailyRate: 1_000_000 }), "dailyRate");
    const res = await asOwner("post", "/api/labours", bigari({ dailyRate: 650.123 }));
    expect(res.status).toBe(400); // three decimals are an error, never silently rounded
  });

  it("rejects a bad name, mobile, village or date", async () => {
    await bad(bigari({ name: "A" }), "name");
    await bad(bigari({ mobile: "12345" }), "mobile");
    await bad(bigari({ mobile: "5876543210" }), "mobile");
    await bad(bigari({ village: "" }), "village");
    await bad(bigari({ joiningDate: "2026-02-30" }), "joiningDate");
    await bad(bigari({ joiningDate: addDays(today, 1) }), "joiningDate");
  });

  it("rejects fields the client must not set", async () => {
    await bad(bigari({ id: "L-999" }));
    await bad(bigari({ statusHistory: [] }));
    await bad(bigari({ createdBy: "x" }));
  });

  it("allows members only for a Patlavale team", async () => {
    await bad(bigari({ members: [{ name: "X" }] }));
    await bad(maapvali({ members: [{ name: "X" }] }));
    await bad(patlavale({ members: Array.from({ length: 31 }, (_, i) => ({ name: `M${i}` })) }), "members");
  });

  it("refuses a query-operator object where a string is expected", async () => {
    await bad(bigari({ mobile: { $gt: "" } }));
  });

  it("rejects a duplicate mobile number (409) and still counts ids up", async () => {
    await create(bigari());
    const res = await asOwner("post", "/api/labours", maapvali({ mobile: "9876543210" }));
    expect(res.status).toBe(409);
    expect(res.body.errors[0].field).toBe("mobile");
    expect(db.labours.size).toBe(1);
  });
});

describe("a failed save never leaves a half-made worker or reuses a number", () => {
  it("removes the new record if its first rate cannot be saved, and does not reuse the id", async () => {
    db.failNextRateCreate = true;
    const failed = await asOwner("post", "/api/labours", bigari());
    expect(failed.status).toBe(500);
    expect(db.labours.size).toBe(0);
    expect(db.rates).toHaveLength(0);
    const next = await create(bigari());
    expect(next.id).toBe("L-002");
  });
});

// ---------------------------------------------------------------------------
describe("reading", () => {
  it("returns one labour, and 404 for an unknown or malformed id", async () => {
    const l = await create(maapvali());
    expect((await asOwner("get", `/api/labours/${l.id}`)).body.data.id).toBe(l.id);
    expect((await asOwner("get", "/api/labours/L-999")).status).toBe(404);
    expect((await asOwner("get", "/api/labours/not-an-id")).status).toBe(404);
    expect((await asOwner("get", "/api/labours/%24ne")).status).toBe(404);
  });

  it("lists everything of all types with paging meta", async () => {
    await create(bigari());
    await create(maapvali());
    await create(patlavale());
    const res = await asOwner("get", "/api/labours");
    expect(res.body.data.map((l) => l.id)).toEqual(["L-001", "L-002", "L-003"]);
    expect(res.body.meta).toEqual({ page: 1, limit: 200, total: 3 });
    const page2 = await asOwner("get", "/api/labours?limit=2&page=2");
    expect(page2.body.data.map((l) => l.id)).toEqual(["L-003"]);
    expect(page2.body.meta.total).toBe(3);
  });

  it("filters by type and by status", async () => {
    await create(bigari());
    await create(bigari({ mobile: "9000000002", name: "Old Hand", status: "INACTIVE" }));
    await create(maapvali());
    const ids = async (qs) => (await asOwner("get", `/api/labours?${qs}`)).body.data.map((l) => l.id);
    expect(await ids("type=BIGARI")).toEqual(["L-001", "L-002"]);
    expect(await ids("type=MAAPVALI")).toEqual(["L-003"]);
    expect(await ids("status=INACTIVE")).toEqual(["L-002"]);
    expect(await ids("type=BIGARI&status=ACTIVE")).toEqual(["L-001"]);
  });

  it("finds workers by name, mobile, id and type name, like the frontend search", async () => {
    await create(bigari());
    await create(maapvali());
    await create(patlavale());
    const ids = async (search) => (await asOwner("get", "/api/labours").query({ search })).body.data.map((l) => l.id);
    expect(await ids("ramesh")).toEqual(["L-001"]);
    expect(await ids("JADHAV")).toEqual(["L-003"]);
    expect(await ids("98765432")).toEqual(["L-001", "L-002", "L-003"]);
    expect(await ids("9876543211")).toEqual(["L-002"]);
    expect(await ids("l-002")).toEqual(["L-002"]);
    expect(await ids("patlavale")).toEqual(["L-003"]);
    expect(await ids("maapvali")).toEqual(["L-002"]);
    expect(await ids("nobody")).toEqual([]);
  });

  it("treats search text as plain text, never as a pattern", async () => {
    await create(bigari());
    const ids = async (search) => (await asOwner("get", "/api/labours").query({ search })).body.data.map((l) => l.id);
    expect(await ids(".*")).toEqual([]);
    expect(await ids("(")).toEqual([]);
    expect(await ids("^R")).toEqual([]);
  });

  it("finds this month's joiners with status=NEW", async () => {
    await create(bigari({ joiningDate: today }));
    await create(bigari({ mobile: "9000000003", joiningDate: "2020-01-01" }));
    const res = await asOwner("get", "/api/labours?status=NEW");
    expect(res.body.data.map((l) => l.id)).toEqual(["L-001"]);
  });

  it("rejects unknown or out-of-range query values", async () => {
    expect((await asOwner("get", "/api/labours?type=DRIVER")).status).toBe(400);
    expect((await asOwner("get", "/api/labours?limit=9999")).status).toBe(400);
    expect((await asOwner("get", "/api/labours?page=0")).status).toBe(400);
    expect((await asOwner("get", "/api/labours?$where=1")).status).toBe(400);
  });

  it("summarises like the frontend's counts", async () => {
    await create(bigari({ joiningDate: today }));
    await create(bigari({ mobile: "9000000004", status: "INACTIVE", joiningDate: "2020-01-01" }));
    await create(maapvali());
    await create(patlavale());
    expect((await asOwner("get", "/api/labours/summary")).body.data).toEqual({ total: 4, active: 3, inactive: 1, newThisMonth: 1, bigari: 2, maapvali: 1, patlavale: 1 });
  });

  it("buildListFilter escapes the search text", () => {
    const filter = buildListFilter({ search: "a.b" }, today);
    const pattern = filter.$and[0].$or[0].name;
    expect(pattern.test("a.b")).toBe(true);
    expect(pattern.test("axb")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe("rate history", () => {
  it("adds a rate change without touching the older rows (Bigari)", async () => {
    const l = await create(bigari({ joiningDate: daysAgo(60) }));
    const res = await asOwner("post", `/api/labours/${l.id}/rates`, { newRate: 700, effectiveFrom: daysAgo(10), reason: "Yearly increase" });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data.rate).toMatchObject({ labourId: l.id, rateType: "DAILY_RATE", rate: 700, effectiveFrom: daysAgo(10), reason: "Yearly increase", changedBy: "Ramesh Patel" });
    expect(res.body.data.labour.dailyRate).toBe(700);

    const history = (await asOwner("get", `/api/labours/${l.id}/rates`)).body.data;
    expect(history.map((r) => [r.rate, r.reason])).toEqual([[700, "Yearly increase"], [650, "Initial rate"]]); // newest first
    expect(db.rates.find((r) => r.reason === "Initial rate").ratePaise).toBe(65000);
  });

  it("keeps each category's own rate type when its rate changes", async () => {
    const m = await create(maapvali({ joiningDate: daysAgo(60) }));
    const p = await create(patlavale({ joiningDate: daysAgo(60) }));
    const rm = await asOwner("post", `/api/labours/${m.id}/rates`, { newRate: 92, effectiveFrom: daysAgo(5), reason: "Revised" });
    const rp = await asOwner("post", `/api/labours/${p.id}/rates`, { newRate: 700, effectiveFrom: daysAgo(5), reason: "Revised" });
    expect(rm.body.data.rate.rateType).toBe("RATE_PER_FOUR_MAAPS");
    expect(rm.body.data.labour).toMatchObject({ ratePerFourMaaps: 92 });
    expect(rm.body.data.labour).not.toHaveProperty("dailyRate");
    expect(rp.body.data.rate.rateType).toBe("RATE_PER_1000_PAYABLE_BRICKS");
    expect(rp.body.data.labour).toMatchObject({ ratePer1000PayableBricks: 700 });
  });

  it("does not apply a future-dated rate until its day", async () => {
    const l = await create(bigari());
    const res = await asOwner("post", `/api/labours/${l.id}/rates`, { newRate: 800, effectiveFrom: addDays(today, 5), reason: "From next week" });
    expect(res.status).toBe(201);
    expect(res.body.data.labour.dailyRate).toBe(650);
    expect((await asOwner("get", `/api/labours/${l.id}`)).body.data.dailyRate).toBe(650);
  });

  it("requires the new date to be after the previous change, and a different rate", async () => {
    const l = await create(bigari({ joiningDate: daysAgo(60) }));
    const post = (body) => asOwner("post", `/api/labours/${l.id}/rates`, { reason: "Because", ...body });
    expect((await post({ newRate: 700, effectiveFrom: daysAgo(60) })).status).toBe(400); // same day as the initial rate
    expect((await post({ newRate: 700, effectiveFrom: daysAgo(90) })).status).toBe(400); // before it
    expect((await post({ newRate: 650, effectiveFrom: daysAgo(10) })).status).toBe(400); // unchanged rate
    expect((await post({ newRate: 700, effectiveFrom: daysAgo(10) })).status).toBe(201);
    expect((await post({ newRate: 720, effectiveFrom: daysAgo(10) })).status).toBe(400); // same day as the last change
    expect((await post({ newRate: 720, effectiveFrom: daysAgo(20) })).status).toBe(400); // no back-dating past a change
    expect(db.rates).toHaveLength(2);
  });

  it("validates the rate change form", async () => {
    const l = await create(bigari());
    const post = (body) => asOwner("post", `/api/labours/${l.id}/rates`, body);
    expect((await post({ newRate: 0, effectiveFrom: today, reason: "Reason" })).status).toBe(400);
    expect((await post({ newRate: "700", effectiveFrom: today, reason: "Reason" })).status).toBe(400);
    expect((await post({ newRate: 700, effectiveFrom: "not-a-date", reason: "Reason" })).status).toBe(400);
    expect((await post({ newRate: 700, effectiveFrom: today, reason: "ab" })).status).toBe(400);
    expect((await post({ newRate: 700, effectiveFrom: today, reason: "Reason", rateType: "DAILY_RATE" })).status).toBe(400);
    expect((await asOwner("post", "/api/labours/L-404/rates", { newRate: 700, effectiveFrom: today, reason: "Reason" })).status).toBe(404);
    expect(db.rates).toHaveLength(1);
  });

  it("prices history by date: the rate in force on a day", () => {
    const rows = sortRatesAsc([
      { effectiveFrom: "2026-03-01", ratePaise: 70000 },
      { effectiveFrom: "2026-01-01", ratePaise: 60000 },
    ]);
    expect(ratePaiseAt(rows, "2025-12-31")).toBe(60000); // before the first row: the first rate, never zero
    expect(ratePaiseAt(rows, "2026-01-01")).toBe(60000);
    expect(ratePaiseAt(rows, "2026-02-28")).toBe(60000);
    expect(ratePaiseAt(rows, "2026-03-01")).toBe(70000);
    expect(ratePaiseAt(rows, "2027-01-01")).toBe(70000);
    expect(ratePaiseAt([], "2026-01-01")).toBeNull();
  });

  it("rate rows cannot be edited after they are written", () => {
    for (const field of ["labourId", "rateType", "ratePaise", "reason", "changedBy"]) {
      expect(RealRate.schema.path(field).options.immutable, field).toBe(true);
    }
    expect(RealRate.schema.indexes().some(([f, o]) => f.labourId === 1 && f.effectiveFrom === 1 && o.unique)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe("editing and deactivating", () => {
  it("updates the basic details", async () => {
    const l = await create(bigari());
    const res = await asOwner("patch", `/api/labours/${l.id}`, { name: "Ramesh K. Patil", village: "Nashik", mobile: "9988776655" });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data).toMatchObject({ id: l.id, name: "Ramesh K. Patil", village: "Nashik", mobile: "9988776655", dailyRate: 650 });
  });

  it("can never change the type, the id or the rate through an edit", async () => {
    const l = await create(bigari());
    for (const body of [{ labourType: "MAAPVALI" }, { id: "L-009" }, { dailyRate: 999 }, { ratePerFourMaaps: 5 }, { rateType: "DAILY_RATE" }]) {
      expect((await asOwner("patch", `/api/labours/${l.id}`, body)).status, JSON.stringify(body)).toBe(400);
    }
    expect((await asOwner("get", `/api/labours/${l.id}`)).body.data).toMatchObject({ labourType: "BIGARI", dailyRate: 650 });
    expect(RealLabour.schema.path("labourType").options.immutable).toBe(true);
  });

  it("rejects an empty edit and a bad value", async () => {
    const l = await create(bigari());
    expect((await asOwner("patch", `/api/labours/${l.id}`, {})).status).toBe(400);
    expect((await asOwner("patch", `/api/labours/${l.id}`, { mobile: "123" })).status).toBe(400);
    expect((await asOwner("patch", `/api/labours/${l.id}`, { statusReason: "no status" })).status).toBe(400);
    expect((await asOwner("patch", "/api/labours/L-404", { village: "X" })).status).toBe(404);
  });

  it("keeps mobile numbers unique across edits", async () => {
    await create(bigari());
    const b = await create(maapvali());
    const res = await asOwner("patch", `/api/labours/${b.id}`, { mobile: "9876543210" });
    expect(res.status).toBe(409);
    expect((await asOwner("patch", `/api/labours/${b.id}`, { mobile: b.mobile, village: "Same" })).status).toBe(200); // own number is fine
  });

  it("deactivates without erasing anything, and records who, when and why", async () => {
    const l = await create(bigari({ joiningDate: daysAgo(60) }));
    await asOwner("post", `/api/labours/${l.id}/rates`, { newRate: 700, effectiveFrom: daysAgo(10), reason: "Raise" });

    const res = await asOwner("patch", `/api/labours/${l.id}`, { status: "INACTIVE", statusReason: "Left the job" });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("INACTIVE");
    expect(res.body.data.statusHistory.at(-1)).toMatchObject({ status: "INACTIVE", by: "Ramesh Patel", reason: "Left the job" });

    // Still there, still has every rate, and still listed under INACTIVE
    expect(db.labours.has(l.id)).toBe(true);
    expect((await asOwner("get", `/api/labours/${l.id}/rates`)).body.data).toHaveLength(2);
    expect((await asOwner("get", "/api/labours?status=INACTIVE")).body.data.map((x) => x.id)).toEqual([l.id]);
    expect((await asOwner("get", "/api/labours?status=ACTIVE")).body.data).toEqual([]);
    expect((await asOwner("get", "/api/labours")).body.data).toHaveLength(1);
  });

  it("can reactivate, and keeps the whole status trail", async () => {
    const l = await create(maapvali());
    await asOwner("patch", `/api/labours/${l.id}`, { status: "INACTIVE", statusReason: "Gone home" });
    const res = await asOwner("patch", `/api/labours/${l.id}`, { status: "ACTIVE", statusReason: "Came back" });
    expect(res.body.data.statusHistory.map((s) => [s.status, s.reason])).toEqual([["ACTIVE", "Created"], ["INACTIVE", "Gone home"], ["ACTIVE", "Came back"]]);
  });

  it("does not add a status entry when the status is unchanged", async () => {
    const l = await create(bigari());
    const res = await asOwner("patch", `/api/labours/${l.id}`, { status: "ACTIVE" });
    expect(res.body.data.statusHistory).toHaveLength(1);
  });

  it("updates Patlavale members, and refuses members on other types", async () => {
    const t = await create(patlavale());
    const res = await asOwner("patch", `/api/labours/${t.id}`, { members: [{ name: "New Head", relation: "Head" }] });
    expect(res.body.data.members).toEqual([{ name: "New Head", relation: "Head" }]);
    const w = await create(bigari({ mobile: "9000000005" }));
    expect((await asOwner("patch", `/api/labours/${w.id}`, { members: [{ name: "X" }] })).status).toBe(400);
  });

  it("moves the Initial rate with the joining date, but not past a later rate change", async () => {
    const l = await create(bigari({ joiningDate: daysAgo(60) }));
    expect((await asOwner("patch", `/api/labours/${l.id}`, { joiningDate: daysAgo(70) })).status).toBe(200);
    expect(db.rates[0].effectiveFrom).toBe(daysAgo(70));

    await asOwner("post", `/api/labours/${l.id}/rates`, { newRate: 700, effectiveFrom: daysAgo(10), reason: "Raise" });
    const blocked = await asOwner("patch", `/api/labours/${l.id}`, { joiningDate: daysAgo(5) });
    expect(blocked.status).toBe(409);
    expect(db.labours.get(l.id).joiningDate).toBe(daysAgo(70));
    expect(db.rates.map((r) => r.effectiveFrom)).toEqual([daysAgo(70), daysAgo(10)]);
  });
});

// ---------------------------------------------------------------------------
describe("models", () => {
  const valid = { _id: "L-001", labourType: "BIGARI", name: "Ramesh", mobile: "9876543210", village: "Sinnar", joiningDate: "2026-01-01" };
  const errorsOf = (data) => new RealLabour(data).validateSync()?.errors ?? {};

  it("accepts a valid record and rejects bad ids, types, mobiles and dates", () => {
    expect(errorsOf(valid)).toEqual({});
    expect(errorsOf({ ...valid, _id: "X-1" })._id).toBeDefined();
    expect(errorsOf({ ...valid, labourType: "DRIVER" }).labourType).toBeDefined();
    expect(errorsOf({ ...valid, mobile: "123" }).mobile).toBeDefined();
    expect(errorsOf({ ...valid, joiningDate: "2026-13-01" }).joiningDate).toBeDefined();
  });

  it("has a unique mobile index and no rate stored on the labour itself", () => {
    expect(RealLabour.schema.indexes().some(([f, o]) => f.mobile === 1 && o.unique)).toBe(true);
    for (const field of ["dailyRate", "ratePerFourMaaps", "ratePer1000PayableBricks", "rate"]) expect(RealLabour.schema.path(field)).toBeUndefined();
  });

  it("keeps members off non-Patlavale records", () => {
    expect(errorsOf({ ...valid, members: [{ name: "X" }] })).toHaveProperty("members");
    expect(errorsOf({ ...valid, labourType: "PATLAVALE", members: [{ name: "X" }] })).toEqual({});
  });
});
