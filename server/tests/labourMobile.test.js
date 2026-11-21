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
vi.mock("../models/Season.js", async (importOriginal) => ({ default: makeSeasonModel((await importOriginal()).default) }));
vi.mock("../models/Attendance.js", () => ({ default: makeAttendanceModel() }));
vi.mock("../models/MaapEntry.js", () => ({ default: makeMaapEntryModel() }));
vi.mock("../models/ProductionEntry.js", () => ({ default: makeProductionEntryModel() }));
vi.mock("../models/Payment.js", async (importOriginal) => ({ default: makePaymentModel((await importOriginal()).default) }));

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

const stored = (id) => db.labours.get(id);
const patch = (id, body) => asOwner("patch", `/api/labours/${id}`, body);
const omit = (o, key) => {
  const { [key]: _gone, ...rest } = o;
  return rest;
};

describe("creating a worker without a mobile number", () => {
  it("accepts an omitted mobile and stores null", async () => {
    const res = await asOwner("post", "/api/labours", omit(bigari(), "mobile"));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data.mobile).toBeNull();
    expect(stored(res.body.data.id).mobile).toBeNull();
    expect(db.rates).toHaveLength(1); // the first rate is saved as usual
  });
  it("accepts mobile: null", async () => {
    const res = await asOwner("post", "/api/labours", bigari({ mobile: null }));
    expect(res.status).toBe(201);
    expect(stored(res.body.data.id).mobile).toBeNull();
  });
  it("accepts an empty or blank mobile and stores null, never an empty string", async () => {
    for (const mobile of ["", "   "]) {
      const res = await asOwner("post", "/api/labours", maapvali({ mobile }));
      expect(res.status, JSON.stringify(mobile)).toBe(201);
      expect(res.body.data.mobile).toBeNull();
      expect(stored(res.body.data.id).mobile).toBeNull();
    }
  });
  it("works for every category", async () => {
    for (const make of [bigari, maapvali, patlavale]) {
      const res = await asOwner("post", "/api/labours", omit(make(), "mobile"));
      expect(res.status, make.name).toBe(201);
      expect(res.body.data.mobile).toBeNull();
    }
  });
  it("several workers can have no mobile number at all", async () => {
    for (let i = 0; i < 3; i += 1) expect((await asOwner("post", "/api/labours", omit(bigari({ name: `Worker ${i + 1}` }), "mobile"))).status).toBe(201);
    expect(db.labours.size).toBe(3);
  });
  it("a number that IS given must still be a valid 10-digit mobile number, as before", async () => {
    for (const mobile of ["12345", "5876543210", "98765432101", "98765 43210", 9876543210, { $gt: "" }, ["9876543210"]]) {
      const res = await asOwner("post", "/api/labours", bigari({ mobile }));
      expect(res.status, JSON.stringify(mobile)).toBe(400);
    }
    expect(db.labours.size).toBe(0);
  });
});

describe("the same mobile number for several workers", () => {
  it("within one category", async () => {
    const a = await create(bigari({ name: "Ramesh Kumar" }));
    const b = await create(bigari({ name: "Suresh Kumar" })); // same default number
    expect(a.mobile).toBe(b.mobile);
    expect(a.id).not.toBe(b.id);
  });
  it("across categories: one person registered as Maapvali and as Bigari, with separate ids", async () => {
    const m = await create(maapvali({ name: "Santosh More", mobile: "9000011111" }));
    const b = await create(bigari({ name: "Santosh More", mobile: "9000011111" }));
    const t = await create(patlavale({ mobile: "9000011111" }));
    expect(new Set([m.id, b.id, t.id]).size).toBe(3);
    expect([m, b, t].map((x) => x.mobile)).toEqual(["9000011111", "9000011111", "9000011111"]);
    expect([m.labourType, b.labourType, t.labourType]).toEqual(["MAAPVALI", "BIGARI", "PATLAVALE"]);
  });
  it("a search by that number finds every worker who has it; workers without one never match a number", async () => {
    await create(bigari({ mobile: "9000022222", name: "Aaa Aaa" }));
    await create(maapvali({ mobile: "9000022222", name: "Bbb Bbb" }));
    await create(bigari({ mobile: null, name: "Ccc Ccc" }));
    const found = await asOwner("get", "/api/labours?search=9000022222");
    expect(found.status).toBe(200);
    expect(found.body.data.map((l) => l.name).sort()).toEqual(["Aaa Aaa", "Bbb Bbb"]);
    expect((await asOwner("get", "/api/labours?search=Ccc")).body.data).toHaveLength(1);
  });
});

describe("editing the mobile number", () => {
  it("clears it with null, with an empty string and with blanks; the stored value is null", async () => {
    for (const cleared of [null, "", "   "]) {
      const w = await create(bigari({ name: `Worker ${JSON.stringify(cleared)}`, mobile: "9000033333" }));
      const res = await patch(w.id, { mobile: cleared });
      expect(res.status, JSON.stringify(cleared)).toBe(200);
      expect(res.body.data.mobile).toBeNull();
      expect(stored(w.id).mobile).toBeNull();
    }
  });
  it("adds a number to a worker who had none", async () => {
    const w = await create(omit(bigari(), "mobile"));
    const res = await patch(w.id, { mobile: "9000044444" });
    expect(res.status).toBe(200);
    expect(res.body.data.mobile).toBe("9000044444");
  });
  it("changes it to a number another worker already uses", async () => {
    await create(bigari({ mobile: "9000055555" }));
    const b = await create(maapvali({ mobile: "9000066666" }));
    const res = await patch(b.id, { mobile: "9000055555" });
    expect(res.status).toBe(200);
    expect(res.body.data.mobile).toBe("9000055555");
  });
  it("omitting the field leaves it alone, and an invalid number is still refused", async () => {
    const w = await create(bigari({ mobile: "9000077777" }));
    expect((await patch(w.id, { village: "Nashik" })).body.data.mobile).toBe("9000077777");
    expect((await patch(w.id, { mobile: "123" })).status).toBe(400);
    expect(stored(w.id).mobile).toBe("9000077777");
  });
  it("changes nothing else: rate, history, status and type are untouched by clearing the number", async () => {
    const w = await create(bigari({ mobile: "9000088888" }));
    const before = JSON.stringify([db.rates, { ...stored(w.id), mobile: 0, updatedAt: 0, __v: 0 }]);
    await patch(w.id, { mobile: null });
    expect(JSON.stringify([db.rates, { ...stored(w.id), mobile: 0, updatedAt: 0, __v: 0 }])).toBe(before);
  });
});

describe("the worker id stays the identity", () => {
  it("ids keep counting up whether or not there is a number", async () => {
    const ids = [];
    for (const m of ["9000099999", null, "9000099999", ""]) ids.push((await create(bigari({ mobile: m }))).id);
    expect(ids).toEqual(["L-001", "L-002", "L-003", "L-004"]);
  });
  it("a duplicate worker id is still refused by the database rule and is NOT reported as a mobile problem", async () => {
    await create(bigari());
    for (const key of Object.keys(db.counters)) db.counters[key] = 0;
    const before = db.labours.size;
    const res = await asOwner("post", "/api/labours", bigari({ name: "Another Person", mobile: null }));
    expect(res.status).toBe(409);
    expect(res.body.message).not.toContain("mobile");
    expect(db.labours.size).toBe(before);
  });
  it("an OLD database that still has the unique mobile index refuses a shared or second empty number with a clear, honest message", async () => {
    await create(omit(bigari(), "mobile"));
    db.legacyUniqueMobile = true;
    const res = await asOwner("post", "/api/labours", omit(bigari({ name: "Second Person" }), "mobile"));
    expect(res.status).toBe(409);
    expect(res.body.errors[0].field).toBe("mobile");
    expect(res.body.message).toMatch(/administrator|index/i);
    expect(db.labours.size).toBe(1);
  });
  it("the schema has no mobile index and stores null for 'no number'", () => {
    expect(RealLabour.schema.indexes().some(([fields]) => "mobile" in fields)).toBe(false);
    expect(new RealLabour({}).mobile).toBeNull();
    expect(new RealLabour({ mobile: "" }).mobile).toBeNull();
    expect(new RealLabour({ mobile: "  " }).mobile).toBeNull();
    expect(new RealLabour({ mobile: " 9876543210 " }).mobile).toBe("9876543210");
    const bad = new RealLabour({ _id: "L-001", labourType: "BIGARI", name: "Ramesh", village: "V", joiningDate: "2026-01-01", mobile: "123" });
    expect(bad.validateSync().errors.mobile).toBeDefined();
    const none = new RealLabour({ _id: "L-001", labourType: "BIGARI", name: "Ramesh", village: "V", joiningDate: "2026-01-01" });
    expect(none.validateSync()).toBeUndefined();
  });
});

describe("existing workers and calculations are unchanged", () => {
  it("a worker saved before this change (with a number) reads exactly as before, next to workers with none", async () => {
    const old = await create(bigari({ mobile: "9810012345" }));
    const none = await create(omit(bigari({ name: "No Phone" }), "mobile"));
    const list = (await asOwner("get", "/api/labours")).body.data;
    expect(list.find((l) => l.id === old.id)).toMatchObject({ mobile: "9810012345", dailyRate: 650, labourType: "BIGARI", status: "ACTIVE" });
    expect(list.find((l) => l.id === none.id)).toMatchObject({ mobile: null, dailyRate: 650, labourType: "BIGARI", status: "ACTIVE" });
    expect((await asOwner("get", `/api/labours/${none.id}`)).body.data.mobile).toBeNull();
    expect((await asOwner("get", "/api/labours/summary")).status).toBe(200);
  });
  it("a worker with no number takes part in attendance and rates exactly like any other", async () => {
    const none = await create(omit(bigari(), "mobile"));
    const day = daysAgo(2);
    const att = await asOwner("put", `/api/attendance/${day}`, { entries: [{ labourId: none.id, status: "PRESENT" }], reason: "Late entry" });
    expect(att.status, JSON.stringify(att.body)).toBe(200);
    expect((await asOwner("get", `/api/labours/${none.id}/rates`)).body.data).toHaveLength(1);
  });
});
