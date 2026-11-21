import mongoose from "mongoose";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.NODE_ENV = "test";
  process.env.BCRYPT_ROUNDS = "4";
  process.env.CLIENT_ORIGIN = "http://localhost:5173";
  process.env.JWT_SECRET = "unit-test-secret-that-is-long-enough-0123456789";
  process.env.MONGODB_URI = "";
});

// Batch 1B closing fix: a labour UPDATE that moves the joining date changes two documents (the worker and its first rate-history
// row). Here the REAL utils/transaction.js runs (not mocked); only mongoose.startSession is replaced by a fake session whose
// withTransaction rolls back the in-memory store on failure. Nothing connects to a database.
const { db, makeAttendanceModel, makeCounterModel, makeLabourModel, makeMaapEntryModel, makePaymentModel, makeProductionEntryModel, makeRateModel } = await import("./helpers/memoryDb.js");
const users = vi.hoisted(() => ({ list: [] }));
const connectBlocked = vi.hoisted(() => vi.fn(() => { throw new Error("TEST SAFETY: a database connection was attempted in a mocked test"); }));

vi.mock("../config/db.js", () => ({ getDbStatus: async () => ({ status: "connected", name: "test" }), connectDB: connectBlocked }));
vi.mock("../models/User.js", () => ({ default: { findById: (id) => ({ lean: async () => users.list.find((u) => String(u._id) === String(id)) ?? null }) } }));
vi.mock("../models/Counter.js", () => ({ default: makeCounterModel() }));
vi.mock("../models/Labour.js", async (importOriginal) => ({ default: makeLabourModel((await importOriginal()).default) }));
vi.mock("../models/LabourRateHistory.js", async (importOriginal) => ({ default: makeRateModel((await importOriginal()).default) }));
vi.mock("../models/Attendance.js", () => ({ default: makeAttendanceModel() }));
vi.mock("../models/MaapEntry.js", () => ({ default: makeMaapEntryModel() }));
vi.mock("../models/ProductionEntry.js", () => ({ default: makeProductionEntryModel() }));
vi.mock("../models/Payment.js", async (importOriginal) => ({ default: makePaymentModel((await importOriginal()).default) }));

const connectSpy = vi.spyOn(mongoose, "connect").mockImplementation(connectBlocked);
const { createApp } = await import("../app.js");
const { signAccessToken } = await import("../services/auth.service.js");
const { addDays, todayBusinessDate } = await import("../utils/dates.js");
const FakeLabour = (await import("../models/Labour.js")).default;
const FakeRate = (await import("../models/LabourRateHistory.js")).default;

const ORIGIN = "http://localhost:5173";
const today = todayBusinessDate();
const daysAgo = (n) => addDays(today, -n);
const clone = (v) => JSON.parse(JSON.stringify(v));

const env = { mode: "ok", startSession: null, sessions: [], attempts: 0 };
const baseFindById = FakeLabour.findById;
const baseRateUpdate = FakeRate.updateOne;
const calls = { save: [], rateUpdate: [] };

// A fake MongoDB session: withTransaction runs the work against a snapshot and puts everything back if it throws.
// mode "unsupported": the database refuses (code 20) before the work runs. mode "transient-once": the first attempt does the
// work, then fails with a transient label, so the work must be re-run (like the real driver).
const fakeSession = () => {
  const session = { id: `s${env.sessions.length + 1}`, endSession: vi.fn(async () => {}) };
  session.withTransaction = async (fn) => {
    if (env.mode === "unsupported") throw Object.assign(new Error("Transaction numbers are only allowed on a replica set member or mongos"), { code: 20 });
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      env.attempts += 1;
      try {
        return await db.transaction(async () => {
          const out = await fn(session);
          if (env.mode === "transient-once" && attempt === 1) throw Object.assign(new Error("transient"), { errorLabels: ["TransientTransactionError"] });
          return out;
        });
      } catch (err) {
        if (!(err?.errorLabels ?? []).includes("TransientTransactionError")) throw err;
      }
    }
    throw new Error("too many transient retries");
  };
  env.sessions.push(session);
  return session;
};

let app;
let owner;
let manager;
const addUser = (role, name) => {
  const user = { _id: new mongoose.Types.ObjectId().toString(), name, email: `${role.toLowerCase()}@example.com`, role, isActive: true, tokenVersion: 0 };
  users.list.push(user);
  return { user, cookie: `brickpro_token=${signAccessToken(user)}` };
};
const send = (method, url, cookie, body) => {
  const req = request(app)[method](url).set("Origin", ORIGIN).set("Cookie", cookie);
  return body === undefined ? req : req.send(body);
};
const asOwner = (method, url, body) => send(method, url, owner.cookie, body);
const bigari = (o = {}) => ({ labourType: "BIGARI", name: "Ramesh Kumar", mobile: "9876543210", village: "Sinnar", joiningDate: daysAgo(60), dailyRate: 650, ...o });
const create = async (body) => {
  const res = await asOwner("post", "/api/labours", body);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.data;
};
const stores = () => clone({ labours: [...db.labours], rates: db.rates });
const sessionStarts = () => env.sessions.length;

beforeEach(() => {
  db.reset();
  users.list.length = 0;
  Object.assign(env, { mode: "ok", sessions: [], attempts: 0 });
  calls.save.length = 0;
  calls.rateUpdate.length = 0;
  vi.spyOn(mongoose, "startSession").mockImplementation(async () => fakeSession());
  // record the options each write receives, so the session itself can be asserted
  FakeLabour.findById = async (id) => {
    const doc = await baseFindById.call(FakeLabour, id);
    if (doc) {
      const save = doc.save;
      doc.save = async (...args) => {
        calls.save.push(args[0]);
        if (env.failSave) throw env.failSave;
        return save.apply(doc, args);
      };
    }
    return doc;
  };
  FakeRate.updateOne = async (filter, update, options) => {
    calls.rateUpdate.push(options);
    if (env.failRateUpdate) throw env.failRateUpdate;
    return baseRateUpdate(filter, update, options);
  };
  env.failSave = null;
  env.failRateUpdate = null;
  owner = addUser("OWNER", "Ramesh Patel");
  manager = addUser("MANAGER", "Helper");
  app = createApp();
});

describe("moving the joining date saves the worker and the first rate TOGETHER", () => {
  it("success commits both writes, in one transaction, through the same session", async () => {
    const l = await create(bigari());
    env.sessions.length = 0;
    calls.save.length = 0;
    const res = await asOwner("patch", `/api/labours/${l.id}`, { joiningDate: daysAgo(70) });
    expect(res.status).toBe(200);
    expect(res.body.data.joiningDate).toBe(daysAgo(70));
    expect(db.labours.get(l.id).joiningDate).toBe(daysAgo(70));
    expect(db.rates).toHaveLength(1);
    expect(db.rates[0].effectiveFrom).toBe(daysAgo(70));
    expect(sessionStarts()).toBe(1);
    expect(calls.save).toHaveLength(1);
    expect(calls.rateUpdate).toHaveLength(1);
    expect(calls.save[0].session).toBe(env.sessions[0]);
    expect(calls.rateUpdate[0].session).toBe(env.sessions[0]);
    expect(env.sessions[0].endSession).toHaveBeenCalled();
  });

  it("a failure while updating the rate row rolls the worker back too (HTTP 500, nothing partial)", async () => {
    const l = await create(bigari());
    const before = stores();
    env.failRateUpdate = new Error("simulated database failure");
    const res = await asOwner("patch", `/api/labours/${l.id}`, { joiningDate: daysAgo(70), name: "Changed Name", status: "INACTIVE", statusReason: "left" });
    expect(res.status).toBe(500);
    expect(stores()).toEqual(before); // joining date, name, status, statusHistory and the rate row: all unchanged
    expect(db.labours.get(l.id).statusHistory).toHaveLength(1);
    env.failRateUpdate = null;
    const retry = await asOwner("patch", `/api/labours/${l.id}`, { joiningDate: daysAgo(70) }); // the same request works afterwards
    expect(retry.status).toBe(200);
    expect(db.rates[0].effectiveFrom).toBe(daysAgo(70));
  });

  it("a failure while saving the worker leaves the rate row untouched; an OLD database that still has the unique mobile index answers 409 on mobile", async () => {
    const l = await create(bigari());
    const before = stores();
    env.failSave = Object.assign(new Error("E11000 duplicate key"), { code: 11000, keyPattern: { mobile: 1 } }); // the old unique mobile_1 index
    const dup = await asOwner("patch", `/api/labours/${l.id}`, { joiningDate: daysAgo(70), mobile: "9876543299" });
    expect(dup.status).toBe(409);
    expect(dup.body.errors[0].field).toBe("mobile");
    expect(stores()).toEqual(before);
    expect(calls.rateUpdate).toHaveLength(0);
    env.failSave = new Error("simulated save failure");
    const other = await asOwner("patch", `/api/labours/${l.id}`, { joiningDate: daysAgo(70) });
    expect(other.status).toBe(500);
    expect(stores()).toEqual(before);
  });

  it("a failed commit AFTER both writes (transaction failure) leaves no partial data", async () => {
    const l = await create(bigari());
    const before = stores();
    env.mode = "commit-fails";
    const original = mongoose.startSession;
    vi.spyOn(mongoose, "startSession").mockImplementation(async () => {
      const s = fakeSession();
      s.withTransaction = async (fn) =>
        db.transaction(async () => {
          await fn(s);
          throw new Error("commit failed");
        });
      return s;
    });
    const res = await asOwner("patch", `/api/labours/${l.id}`, { joiningDate: daysAgo(70) });
    expect(res.status).toBe(500);
    expect(stores()).toEqual(before);
    expect(original).toBeDefined();
  });

  it("a transient error re-runs the work and the final state is the same as a single run", async () => {
    const l = await create(bigari());
    env.mode = "transient-once";
    env.attempts = 0;
    const res = await asOwner("patch", `/api/labours/${l.id}`, { joiningDate: daysAgo(70), village: "Nashik" });
    expect(res.status).toBe(200);
    expect(env.attempts).toBe(2);
    expect(db.labours.get(l.id)).toMatchObject({ joiningDate: daysAgo(70), village: "Nashik" });
    expect(db.rates).toHaveLength(1);
    expect(db.rates[0].effectiveFrom).toBe(daysAgo(70));
  });

  it("on a database without transactions: HTTP 503, 'Nothing ran', no partial write", async () => {
    const l = await create(bigari());
    const before = stores();
    env.mode = "unsupported";
    calls.save.length = 0;
    const res = await asOwner("patch", `/api/labours/${l.id}`, { joiningDate: daysAgo(70) });
    expect(res.status).toBe(503);
    expect(res.body.message).toMatch(/does not support transactions.*Nothing was saved/s);
    expect(stores()).toEqual(before);
    expect(calls.save).toHaveLength(0);
    expect(calls.rateUpdate).toHaveLength(0);
  });
});

describe("existing behaviour is unchanged", () => {
  it("an update that does not move the joining date needs no transaction (one document), even on a database without them", async () => {
    const l = await create(bigari());
    env.sessions.length = 0;
    env.mode = "unsupported";
    const res = await asOwner("patch", `/api/labours/${l.id}`, { name: "New Name", village: "Nashik", status: "INACTIVE", statusReason: "left" });
    expect(res.status).toBe(200);
    expect(sessionStarts()).toBe(0);
    expect(res.body.data).toMatchObject({ name: "New Name", village: "Nashik", status: "INACTIVE" });
    expect(res.body.data.statusHistory).toHaveLength(2);
    expect(db.rates[0].effectiveFrom).toBe(daysAgo(60)); // first rate untouched
  });

  it("the same joining date again changes no rate row and needs no transaction", async () => {
    const l = await create(bigari());
    env.sessions.length = 0;
    const res = await asOwner("patch", `/api/labours/${l.id}`, { joiningDate: daysAgo(60), village: "Nashik" });
    expect(res.status).toBe(200);
    expect(sessionStarts()).toBe(0);
    expect(db.rates[0].effectiveFrom).toBe(daysAgo(60));
  });

  it("validation still runs BEFORE any transaction: a joining date past a later rate change is a 409 with nothing written", async () => {
    const l = await create(bigari());
    await asOwner("post", `/api/labours/${l.id}/rates`, { newRate: 700, effectiveFrom: daysAgo(10), reason: "Raise" });
    const before = stores();
    env.sessions.length = 0;
    const res = await asOwner("patch", `/api/labours/${l.id}`, { joiningDate: daysAgo(5) });
    expect(res.status).toBe(409);
    expect(res.body.errors[0].field).toBe("joiningDate");
    expect(sessionStarts()).toBe(0);
    expect(stores()).toEqual(before);
  });

  it("an unknown id, a bad body and a non-owner never start a transaction", async () => {
    await create(bigari());
    const b = await create(bigari({ mobile: "9000000002" }));
    env.sessions.length = 0;
    expect((await asOwner("patch", "/api/labours/L-999", { joiningDate: daysAgo(70) })).status).toBe(404);
    expect((await asOwner("patch", `/api/labours/${b.id}`, { joiningDate: "2026-02-30" })).status).toBe(400);
    expect((await asOwner("patch", `/api/labours/${b.id}`, { joiningDate: daysAgo(70), dailyRate: 1 })).status).toBe(400);
    expect((await send("patch", `/api/labours/${b.id}`, manager.cookie, { joiningDate: daysAgo(70) })).status).toBe(403);
    expect(sessionStarts()).toBe(0);
    expect(db.labours.get(b.id).joiningDate).toBe(daysAgo(60));
  });

  it("the response shape equals a plain read of the same worker", async () => {
    const l = await create(bigari());
    const res = await asOwner("patch", `/api/labours/${l.id}`, { joiningDate: daysAgo(70) });
    const get = await asOwner("get", `/api/labours/${l.id}`);
    expect(res.body.data).toEqual(get.body.data);
    expect(Object.keys(res.body).sort()).toEqual(["data", "message", "success"].sort());
  });

  it("never connected to a database", () => {
    expect(connectSpy).not.toHaveBeenCalled();
    expect(connectBlocked).not.toHaveBeenCalled();
  });
});
