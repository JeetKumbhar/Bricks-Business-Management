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
const { db, makeAttendanceModel, makeCounterModel, makeLabourModel, makeMaapEntryModel, makePaymentModel, makeProductionEntryModel, makeRateModel, makeSeasonModel, makeTruckHistoryModel, makeTruckModel, makeTruckTripModel, makeCustomerModel, makeBillModel } = await import("./helpers/memoryDb.js");
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
vi.mock("../models/Payment.js", async (importOriginal) => ({ default: makePaymentModel((await importOriginal()).default) }));
vi.mock("../models/Truck.js", async (importOriginal) => ({ default: makeTruckModel((await importOriginal()).default) }));
vi.mock("../models/TruckStatusHistory.js", async (importOriginal) => ({ default: makeTruckHistoryModel((await importOriginal()).default) }));
vi.mock("../models/Customer.js", async (importOriginal) => ({ default: makeCustomerModel((await importOriginal()).default) }));
vi.mock("../models/Bill.js", async (importOriginal) => ({ default: makeBillModel((await importOriginal()).default) }));
vi.mock("../models/TruckTrip.js", async (importOriginal) => ({ default: makeTruckTripModel((await importOriginal()).default) }));
vi.mock("../utils/transaction.js", () => ({ runInTransaction: (work) => db.transaction(() => work(null)) }));

const { createApp } = await import("../app.js");
const { signAccessToken } = await import("../services/auth.service.js");
const { summarizeTrips, groupTrips } = await import("../services/truckTripCalculations.js");
const { quantityError, resolveTripMaterial, truckNumberKey } = await import("../utils/truckRules.js");
const { addDays, todayBusinessDate } = await import("../utils/dates.js");
const RealTruck = (await vi.importActual("../models/Truck.js")).default;
const RealTrip = (await vi.importActual("../models/TruckTrip.js")).default;

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
let truckSeq = 0;
const addTruck = async (o = {}) => {
  const res = await asOwner("post", "/api/trucks", { truckNumber: `MH-04-AB-${1001 + truckSeq++}`, ...o });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.data;
};
const setStatus = (t, body) => asOwner("post", `/api/trucks/${t.id}/status`, body);
const historyOf = async (t) => (await asOwner("get", `/api/trucks/${t.id}/history`)).body.data;

// Every NEW Pheera needs a customer (Pheera <-> Bills integration); the tests share one saved customer.
let CUSTOMER_ID = "";
const bricks = (quantity, destination = "Palghar", extra = {}) => ({ customerId: CUSTOMER_ID, material: "BRICKS", destination, quantity, ...extra });
const soil = (quantity, destination = "Palghar", extra = {}) => ({ customerId: CUSTOMER_ID, material: "SOIL", destination, quantity, ...extra });
const other = (name, quantity, destination = "Palghar", extra = {}) => ({ customerId: CUSTOMER_ID, material: "OTHER", customMaterialName: name, destination, quantity, ...extra });
const batch = (t, date, trips, extra = {}) => asOwner("post", "/api/truck-trips/batch", { truckId: t.id, businessDate: date, trips, ...extra });
const saved = async (t, date, trips, extra) => {
  const res = await batch(t, date, trips, extra);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.data;
};
const one = (t, date, row, extra = {}) => asOwner("post", "/api/truck-trips", { truckId: t.id, businessDate: date, ...row, ...extra });
const tripRows = (t, date) => [...db.trips.values()].filter((r) => r.truckId === t.id && r.businessDate === date).sort((a, b) => a.pheeraNo - b.pheeraNo);
const numbers = (t, date) => tripRows(t, date).map((r) => r.pheeraNo);
const list = async (q = "") => (await asOwner("get", `/api/truck-trips${q}`)).body;
const report = async (path, q = "") => (await asOwner("get", `/api/truck-reports/${path}${q}`)).body.data;
const otherModulesSnapshot = () => JSON.stringify([[...db.labours.values()], db.rates, [...db.attendance.values()], [...db.maap.values()], [...db.production.values()], [...db.payments.values()], [...db.seasons.values()]]);

beforeEach(() => {
  today = todayBusinessDate();
  db.reset();
  users.list.length = 0;
  mobileSeq = 0;
  truckSeq = 0;
  owner = addUser("OWNER");
  manager = addUser("MANAGER", "Helper");
  app = createApp();
  CUSTOMER_ID = new mongoose.Types.ObjectId().toString();
  db.customers.set(CUSTOMER_ID, { _id: CUSTOMER_ID, name: "Test Customer", customerKey: "test customer", kind: "NORMAL", isDeleted: false, revision: 1, history: [] });
});
afterEach(() => vi.useRealTimers());

// ---------------------------------------------------------------------------
describe("access", () => {
  it("needs a login for every truck, Pheera and report route", async () => {
    const id = "aaaaaaaaaaaaaaaaaaaaaaaa";
    for (const [method, url] of [
      ["get", "/api/trucks"], ["get", "/api/trucks/working"], ["get", "/api/trucks/stopped"], ["post", "/api/trucks"], ["get", `/api/trucks/${id}`], ["patch", `/api/trucks/${id}`], ["post", `/api/trucks/${id}/status`], ["get", `/api/trucks/${id}/history`],
      ["get", "/api/truck-trips"], ["get", `/api/truck-trips/day?date=${today}`], ["get", "/api/truck-trips/options"], ["post", "/api/truck-trips"], ["post", "/api/truck-trips/batch"], ["get", `/api/truck-trips/${id}`], ["patch", `/api/truck-trips/${id}`], ["delete", `/api/truck-trips/${id}`], ["post", `/api/truck-trips/${id}/void`],
      ["get", `/api/truck-reports/truck/${id}`], ["get", `/api/truck-reports/daily?date=${today}`], ["get", `/api/truck-reports/range?from=${today}&to=${today}`], ["get", "/api/truck-reports/material"], ["get", "/api/truck-reports/destination"], ["get", "/api/truck-reports/all-trucks"],
    ]) {
      expect((await send(method, url, null, method === "get" ? undefined : {})).status, `${method} ${url}`).toBe(401);
    }
  });

  it("lets a non-owner read but not change trucks or Pheera", async () => {
    const t = await addTruck();
    const [p] = await saved(t, today, [bricks(1000)]);
    for (const url of ["/api/trucks", `/api/trucks/${t.id}`, `/api/trucks/${t.id}/history`, "/api/truck-trips", `/api/truck-trips/${p.id}`, "/api/truck-reports/all-trucks"]) expect((await send("get", url, manager.cookie)).status, url).toBe(200);
    const denied = [
      ["post", "/api/trucks", { truckNumber: "MH-12-XY-9999" }],
      ["patch", `/api/trucks/${t.id}`, { model: "Tata" }],
      ["post", `/api/trucks/${t.id}/status`, { status: "STOPPED", reason: "BREAKDOWN" }],
      ["post", "/api/truck-trips", { truckId: t.id, businessDate: today, ...bricks(10) }],
      ["post", "/api/truck-trips/batch", { truckId: t.id, businessDate: today, trips: [bricks(10)] }],
      ["patch", `/api/truck-trips/${p.id}`, { quantity: 5, reason: "Miscounted" }],
      ["delete", `/api/truck-trips/${p.id}`, { reason: "Wrong truck" }],
      ["post", `/api/truck-trips/${p.id}/void`, { reason: "Wrong truck" }],
    ];
    for (const [method, url, body] of denied) expect((await send(method, url, manager.cookie, body)).status, `${method} ${url}`).toBe(403);
    expect(db.trucks.size).toBe(1);
    expect(db.trips.size).toBe(1);
  });

  it("has no delete route for trucks", async () => {
    const t = await addTruck();
    expect((await asOwner("delete", `/api/trucks/${t.id}`, { reason: "gone" })).status).toBe(404);
    expect(db.trucks.size).toBe(1);
  });
});

// ---------------------------------------------------------------------------
describe("trucks: create and update", () => {
  it("creates a truck that starts Working, with a 'Truck added' history row", async () => {
    const t = await addTruck({ truckNumber: "mh 04  ab 1234", nickname: "TRK-01", model: "Tata 1109", capacity: 12 });
    expect(t).toMatchObject({ truckNumber: "MH 04 AB 1234", nickname: "TRK-01", model: "Tata 1109", capacity: 12, driverId: null, status: "WORKING", stopReason: null, statusNote: "" });
    expect(t.id).toMatch(/^[0-9a-f]{24}$/);
    const history = await historyOf(t);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ kind: "CREATED", from: null, to: "WORKING", note: "Truck added", changedBy: "Ramesh Patel" });
  });

  it("rejects a duplicate registration number however it is typed", async () => {
    await addTruck({ truckNumber: "MH-04-AB-1234" });
    for (const truckNumber of ["MH-04-AB-1234", "mh-04-ab-1234", "MH 04 AB 1234", "MH04AB1234", " mh04 ab-1234 "]) {
      const res = await asOwner("post", "/api/trucks", { truckNumber });
      expect(res.status, truckNumber).toBe(409);
      expect(res.body.errors[0].field).toBe("truckNumber");
    }
    expect(db.trucks.size).toBe(1);
  });

  it("a duplicate caught by the database index is also a 409", async () => {
    await addTruck({ truckNumber: "MH-04-AB-1234" });
    const [existing] = [...db.trucks.values()];
    const Truck = (await import("../models/Truck.js")).default;
    await expect(Truck.insertMany([{ truckNumber: "X", truckKey: existing.truckKey, statusSince: new Date() }])).rejects.toMatchObject({ code: 11000 });
  });

  it("validates the fields and rejects unknown ones (status and history cannot be set here)", async () => {
    for (const body of [{}, { truckNumber: "AB" }, { truckNumber: "---" }, { truckNumber: "x".repeat(21) }, { truckNumber: "MH-04-AB-1234", capacity: 0 }, { truckNumber: "MH-04-AB-1234", capacity: "12" }, { truckNumber: "MH-04-AB-1234", status: "STOPPED" }, { truckNumber: "MH-04-AB-1234", driverId: "nobody" }, { truckNumber: "MH-04-AB-1234", history: [] }]) {
      expect((await asOwner("post", "/api/trucks", body)).status, JSON.stringify(body)).toBe(400);
    }
    expect(db.trucks.size).toBe(0);
  });

  it("links a driver only when they are an active Bigari or Maapvali worker", async () => {
    const [bigari, maapvali, team] = [await makeLabour("BIGARI"), await makeLabour("MAAPVALI"), await makeLabour("PATLAVALE")];
    expect((await addTruck({ driverId: bigari.id })).driverId).toBe(bigari.id);
    expect((await addTruck({ driverId: maapvali.id })).driverId).toBe(maapvali.id);
    expect((await asOwner("post", "/api/trucks", { truckNumber: "MH-12-XY-0001", driverId: team.id })).status).toBe(400);
    expect((await asOwner("post", "/api/trucks", { truckNumber: "MH-12-XY-0002", driverId: "L-404" })).status).toBe(400);
    await asOwner("patch", `/api/labours/${bigari.id}`, { status: "INACTIVE" });
    expect((await asOwner("post", "/api/trucks", { truckNumber: "MH-12-XY-0003", driverId: bigari.id })).status).toBe(400);
  });

  it("updates details, keeps the status, and allows keeping its own number", async () => {
    const t = await addTruck({ truckNumber: "MH-04-AB-1234" });
    const res = await asOwner("patch", `/api/trucks/${t.id}`, { truckNumber: "mh04ab1234", nickname: "Big one", model: "Eicher", capacity: 15 });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ truckNumber: "MH04AB1234", nickname: "Big one", model: "Eicher", capacity: 15, status: "WORKING" });
    expect((await asOwner("patch", `/api/trucks/${t.id}`, { capacity: null })).body.data.capacity).toBeNull();
  });

  it("refuses an update to another truck's number, an empty update and a status field", async () => {
    const [a, b] = [await addTruck(), await addTruck()];
    expect((await asOwner("patch", `/api/trucks/${b.id}`, { truckNumber: a.truckNumber.toLowerCase() })).status).toBe(409);
    expect((await asOwner("patch", `/api/trucks/${a.id}`, {})).status).toBe(400);
    expect((await asOwner("patch", `/api/trucks/${a.id}`, { status: "STOPPED" })).status).toBe(400);
    expect((await asOwner("patch", "/api/trucks/aaaaaaaaaaaaaaaaaaaaaaaa", { model: "x" })).status).toBe(404);
    expect((await asOwner("patch", "/api/trucks/nope", { model: "x" })).status).toBe(400);
  });

  it("a driver change is recorded in the history with the old and new driver", async () => {
    const [d1, d2] = [await makeLabour("BIGARI", { name: "Suresh" }), await makeLabour("BIGARI", { name: "Mahesh" })];
    const t = await addTruck({ driverId: d1.id });
    await asOwner("patch", `/api/trucks/${t.id}`, { driverId: d2.id });
    await asOwner("patch", `/api/trucks/${t.id}`, { driverId: d2.id }); // unchanged: no new row
    await asOwner("patch", `/api/trucks/${t.id}`, { driverId: null });
    const rows = (await historyOf(t)).filter((h) => h.kind === "DRIVER");
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ previousDriverId: d1.id, newDriverId: d2.id });
    expect(rows[1].note).toContain("Suresh");
    expect(rows[1].note).toContain("Mahesh");
    expect(rows[0]).toMatchObject({ previousDriverId: d2.id, newDriverId: null });
  });

  it("adding a truck and its history row is all-or-nothing", async () => {
    db.failHistoryInsert = true;
    const res = await asOwner("post", "/api/trucks", { truckNumber: "MH-04-AB-7777" });
    expect(res.status).toBe(500);
    expect(db.trucks.size).toBe(0);
    expect(db.truckHistory.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
describe("trucks: Working, Stopped and Maintenance", () => {
  it("Stopped needs a reason, and Other needs a note", async () => {
    const t = await addTruck();
    for (const body of [{ status: "STOPPED" }, { status: "STOPPED", reason: "FLAT" }, { status: "STOPPED", reason: "OTHER" }, { status: "STOPPED", reason: "OTHER", note: "   " }, { status: "MAINTENANCE" }, { status: "MAINTENANCE", description: "ab" }, { status: "BROKEN" }, { status: "WORKING", reason: "BREAKDOWN" }, { status: "STOPPED", reason: "BREAKDOWN", extra: 1 }]) {
      expect((await setStatus(t, body)).status, JSON.stringify(body)).toBe(400);
    }
    expect((await asOwner("get", `/api/trucks/${t.id}`)).body.data.status).toBe("WORKING");
    expect((await historyOf(t))).toHaveLength(1);
  });

  it("Working -> Stopped keeps the reason, note and time on the truck", async () => {
    const t = await addTruck();
    const res = await setStatus(t, { status: "STOPPED", reason: "OTHER", note: "Waiting for a part" });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ status: "STOPPED", stopReason: "OTHER", statusNote: "Waiting for a part" });
    expect(res.body.data.statusSince).toBeTruthy();
    const again = (await asOwner("get", `/api/trucks/${t.id}`)).body.data;
    expect(again).toMatchObject({ status: "STOPPED", stopReason: "OTHER", statusNote: "Waiting for a part" });
  });

  it("Stopped -> Working clears the current reason, but the history keeps every change", async () => {
    const t = await addTruck();
    await setStatus(t, { status: "STOPPED", reason: "BREAKDOWN", note: "Engine" });
    const back = await setStatus(t, { status: "WORKING" });
    expect(back.body.data).toMatchObject({ status: "WORKING", stopReason: null, statusNote: "" });
    const history = await historyOf(t);
    expect(history.map((h) => [h.kind, h.from, h.to, h.reason])).toEqual([["STATUS", "STOPPED", "WORKING", null], ["STATUS", "WORKING", "STOPPED", "BREAKDOWN"], ["CREATED", null, "WORKING", null]]);
    expect(history[1]).toMatchObject({ note: "Engine", changedBy: "Ramesh Patel" });
  });

  it("Maintenance needs a description, which becomes the note", async () => {
    const t = await addTruck();
    const res = await setStatus(t, { status: "MAINTENANCE", description: "Gearbox service" });
    expect(res.body.data).toMatchObject({ status: "MAINTENANCE", stopReason: null, statusNote: "Gearbox service" });
    expect((await historyOf(t))[0]).toMatchObject({ from: "WORKING", to: "MAINTENANCE", note: "Gearbox service" });
  });

  it("refuses the status the truck already has, so a repeated request changes nothing", async () => {
    const t = await addTruck();
    expect((await setStatus(t, { status: "WORKING" })).status).toBe(409);
    await setStatus(t, { status: "STOPPED", reason: "TYRE_PUNCTURE" });
    const repeat = await setStatus(t, { status: "STOPPED", reason: "TYRE_PUNCTURE" });
    expect(repeat.status).toBe(409);
    expect(await historyOf(t)).toHaveLength(2);
  });

  it("two changes at the same moment cannot both win", async () => {
    const t = await addTruck();
    db.beforeTruckUpdate = () => {
      db.beforeTruckUpdate = null;
      [...db.trucks.values()][0].status = "MAINTENANCE"; // someone else got in first
      db.resnapshot();
    };
    const res = await setStatus(t, { status: "STOPPED", reason: "BREAKDOWN" });
    expect(res.status).toBe(409);
    expect(db.truckHistory.size).toBe(1); // only the original 'added' row: nothing half-saved
    expect([...db.trucks.values()][0].status).toBe("MAINTENANCE");
  });

  it("a status change and its history row are all-or-nothing", async () => {
    const t = await addTruck();
    db.failHistoryInsert = true;
    expect((await setStatus(t, { status: "STOPPED", reason: "BREAKDOWN" })).status).toBe(500);
    expect([...db.trucks.values()][0]).toMatchObject({ status: "WORKING", stopReason: null });
    expect(db.truckHistory.size).toBe(1);
  });

  it("lists trucks, working trucks and stopped trucks, with fleet counts", async () => {
    const [a, b, c] = [await addTruck(), await addTruck({ nickname: "Red" }), await addTruck()];
    await setStatus(b, { status: "STOPPED", reason: "BREAKDOWN" });
    await setStatus(c, { status: "MAINTENANCE", description: "Brake pads" });
    const all = (await asOwner("get", "/api/trucks")).body;
    expect(all.data.map((t) => t.id)).toEqual([a.id, b.id, c.id]);
    expect(all.meta.counts).toEqual({ total: 3, working: 1, stopped: 1, maintenance: 1 });
    expect((await asOwner("get", "/api/trucks/working")).body.data.map((t) => t.id)).toEqual([a.id]);
    expect((await asOwner("get", "/api/trucks/stopped")).body.data.map((t) => t.id)).toEqual([b.id]);
    expect((await asOwner("get", "/api/trucks?status=MAINTENANCE")).body.data.map((t) => t.id)).toEqual([c.id]);
    expect((await asOwner("get", "/api/trucks?search=red")).body.data.map((t) => t.id)).toEqual([b.id]);
    expect((await asOwner("get", "/api/trucks/working")).body.meta.counts.total).toBe(3); // counts ignore the filter
    expect((await asOwner("get", "/api/trucks?status=GONE")).status).toBe(400);
  });

  it("a truck that has Pheera is never removed or cut off from them when it is stopped", async () => {
    const t = await addTruck();
    await saved(t, today, [bricks(1000), soil(3)]);
    await setStatus(t, { status: "STOPPED", reason: "BREAKDOWN" });
    expect((await asOwner("get", `/api/trucks/${t.id}`)).status).toBe(200);
    expect(db.trucks.size).toBe(1);
    expect((await list(`?truckId=${t.id}`)).data).toHaveLength(2);
    expect((await asOwner("delete", `/api/trucks/${t.id}`)).status).toBe(404);
    expect((await asOwner("get", "/api/trucks/aaaaaaaaaaaaaaaaaaaaaaaa")).status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
describe("Pheera: one record per trip, numbered per truck and day", () => {
  it("saves one Pheera", async () => {
    const t = await addTruck();
    const res = await one(t, today, bricks(1000, "Palghar", { remarks: "first load" }));
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ truckId: t.id, truckNumber: t.truckNumber, businessDate: today, pheeraNo: 1, materialCategory: "BRICKS", materialName: "Bricks", quantity: 1000, unit: "bricks", quantityLabel: "Number of Bricks", destination: "Palghar", remarks: "first load", revision: 1, isVoided: false, createdBy: "Ramesh Patel" });
    expect(db.trips.size).toBe(1);
  });

  it("saves five Pheera for one truck and date as five separate records, numbered 1 to 5", async () => {
    const t = await addTruck();
    const records = await saved(t, today, [bricks(1000), bricks(1200), soil(4), other("Stone Dust", 2.5), bricks(900)]);
    expect(records.map((r) => r.pheeraNo)).toEqual([1, 2, 3, 4, 5]);
    expect(db.trips.size).toBe(5); // five documents, not one grouped record
    expect(new Set([...db.trips.values()].map((r) => r._id)).size).toBe(5);
    expect(numbers(t, today)).toEqual([1, 2, 3, 4, 5]);
    expect(records.map((r) => r.materialName)).toEqual(["Bricks", "Bricks", "Soil", "Stone Dust", "Bricks"]);
    expect([...db.trips.values()].every((r) => r.history.length === 0 && r.revision === 1)).toBe(true);
  });

  it("numbers each truck independently and restarts on a new date", async () => {
    const [a, b] = [await addTruck(), await addTruck()];
    await saved(a, D(1), [bricks(100), bricks(200), bricks(300), bricks(400)]);
    await saved(a, D(0), [bricks(100), bricks(200)]);
    await saved(b, D(1), [bricks(100)]);
    await saved(b, D(0), [soil(1), soil(2), soil(3)]);
    expect([numbers(a, D(1)), numbers(a, D(0)), numbers(b, D(1)), numbers(b, D(0))]).toEqual([[1, 2, 3, 4], [1, 2], [1], [1, 2, 3]]);
  });

  it("a later save for the same truck and date continues the numbering", async () => {
    const t = await addTruck();
    await saved(t, today, [bricks(100), bricks(200)]);
    await one(t, today, bricks(300));
    const more = await saved(t, today, [bricks(400), bricks(500)]);
    expect(more.map((r) => r.pheeraNo)).toEqual([4, 5]);
    expect(numbers(t, today)).toEqual([1, 2, 3, 4, 5]);
  });

  it("the database refuses two Pheera with the same number for a truck and date", async () => {
    const t = await addTruck();
    await saved(t, today, [bricks(100)]);
    const TruckTrip = (await import("../models/TruckTrip.js")).default;
    const [first] = [...db.trips.values()];
    const { _id, createdAt, updatedAt, ...copy } = first;
    await expect(TruckTrip.insertMany([copy])).rejects.toMatchObject({ code: 11000 });
    expect(db.trips.size).toBe(1);
  });

  it("two saves that collide on a number are numbered again, with no duplicates and no gaps", async () => {
    const t = await addTruck();
    await saved(t, today, [bricks(100)]); // Pheera 1 exists
    let injected = false;
    db.beforeTripInsert = (data) => {
      if (injected) return;
      injected = true; // a faster save wins number 2 just before ours is written
      const { _id, createdAt, updatedAt, ...rest } = [...db.trips.values()][0];
      db.trips.set("winner", { ...rest, _id: "winner", pheeraNo: 2, materialCategory: "SOIL", materialName: "Soil", materialKey: "soil", unit: "tonnes", quantity: 2, createdAt, updatedAt });
      db.resnapshot();
    };
    const res = await batch(t, today, [bricks(200), bricks(300)]);
    expect(res.status).toBe(201);
    expect(res.body.data.map((r) => r.pheeraNo)).toEqual([3, 4]);
    expect(numbers(t, today)).toEqual([1, 2, 3, 4]);
  });

  it("gives up with a clear conflict if it keeps losing the race", async () => {
    const t = await addTruck();
    let n = 0;
    db.beforeTripInsert = (data) => {
      n += 1;
      const { pheeraNo } = data;
      db.trips.set(`w${n}`, { _id: `w${n}`, truckId: t.id, truckNumber: "X", businessDate: today, pheeraNo, materialCategory: "BRICKS", materialName: "Bricks", materialKey: "bricks", destination: "A", destinationKey: "a", quantity: 1, unit: "bricks", isDeleted: false, history: [], revision: 1, createdAt: new Date(), updatedAt: new Date() });
    };
    expect((await batch(t, today, [bricks(100)])).status).toBe(409);
  });

  it("editing a Pheera never changes its number, truck or date", async () => {
    const t = await addTruck();
    const [a, b, c] = await saved(t, today, [bricks(100), bricks(200), bricks(300)]);
    const res = await asOwner("patch", `/api/truck-trips/${b.id}`, { quantity: 250, destination: "Boisar", remarks: "recounted", reason: "Miscounted" });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ pheeraNo: 2, truckId: t.id, businessDate: today, quantity: 250, destination: "Boisar", revision: 2, corrected: true });
    expect(numbers(t, today)).toEqual([1, 2, 3]);
    for (const body of [{ pheeraNo: 9, reason: "Fix it" }, { businessDate: D(1), reason: "Fix it" }, { truckId: t.id, reason: "Fix it" }, { truckNumber: "X", reason: "Fix it" }]) {
      expect((await asOwner("patch", `/api/truck-trips/${a.id}`, { quantity: 1, ...body })).status, JSON.stringify(body)).toBe(400);
    }
    expect(c.pheeraNo).toBe(3);
  });

  it("voiding keeps the record and its number, and numbers are never reused", async () => {
    const t = await addTruck();
    const [a, b, c] = await saved(t, today, [bricks(100), bricks(200), bricks(300)]);
    await asOwner("delete", `/api/truck-trips/${c.id}`, { reason: "Wrong truck" });
    await asOwner("post", `/api/truck-trips/${a.id}/void`, { reason: "Duplicate entry" });
    expect(db.trips.size).toBe(3);
    const next = await one(t, today, bricks(400));
    expect(next.body.data.pheeraNo).toBe(4); // not 3, not 1
    expect(numbers(t, today)).toEqual([1, 2, 3, 4]);
    expect(new Set(numbers(t, today)).size).toBe(4);
    expect((await asOwner("get", `/api/truck-trips/${b.id}`)).body.data.pheeraNo).toBe(2);
  });

  it("a bulk save is all-or-nothing: a failure part-way leaves no records", async () => {
    const t = await addTruck();
    db.failTripAt = 2; // the third row cannot be written
    const res = await batch(t, today, [bricks(100), bricks(200), bricks(300), bricks(400)]);
    expect(res.status).toBe(500);
    expect(db.trips.size).toBe(0);
    const retry = await batch(t, today, [bricks(100), bricks(200), bricks(300), bricks(400)]);
    expect(retry.status).toBe(201);
    expect(numbers(t, today)).toEqual([1, 2, 3, 4]);
  });

  it("one invalid row rejects the whole batch with row-level errors, and nothing is saved", async () => {
    const t = await addTruck();
    const res = await batch(t, today, [bricks(100), bricks(1.5), soil(0), other("  ", 2)]);
    expect(res.status).toBe(400);
    expect(res.body.errors.map((e) => e.field).sort()).toEqual(["trips.1.quantity", "trips.2.quantity", "trips.3.customMaterialName"]);
    expect(db.trips.size).toBe(0);
  });

  it("the same submissionId twice returns the first records instead of saving again", async () => {
    const t = await addTruck();
    const body = { submissionId: "submission-0001", trips: [{ ...bricks(100), clientRowId: "r1" }, { ...soil(2), clientRowId: "r2" }] };
    const first = await batch(t, today, body.trips, { submissionId: body.submissionId });
    const retry = await batch(t, today, body.trips, { submissionId: body.submissionId });
    const third = await batch(t, today, body.trips, { submissionId: body.submissionId });
    expect([first.status, retry.status, third.status]).toEqual([201, 200, 200]);
    expect([first.body.meta.duplicate, retry.body.meta.duplicate]).toEqual([false, true]);
    expect(retry.body.data.map((r) => r.id)).toEqual(first.body.data.map((r) => r.id));
    expect(db.trips.size).toBe(2);
    expect(numbers(t, today)).toEqual([1, 2]);
  });

  it("a submissionId used for a different truck or date is refused", async () => {
    const [a, b] = [await addTruck(), await addTruck()];
    await batch(a, today, [bricks(100)], { submissionId: "submission-0002" });
    expect((await batch(b, today, [bricks(100)], { submissionId: "submission-0002" })).status).toBe(409);
    expect((await batch(a, D(1), [bricks(100)], { submissionId: "submission-0002" })).status).toBe(409);
    expect(db.trips.size).toBe(1);
  });

  it("two copies of one submission that race return the winner's records", async () => {
    const t = await addTruck();
    const rows = [{ ...bricks(100), clientRowId: "r1" }, { ...bricks(200), clientRowId: "r2" }];
    const body = { submissionId: "submission-0003" };
    db.beforeTripInsert = (data, index) => {
      if (index !== 0) return;
      db.beforeTripInsert = null; // the other copy is saved first
      rows.forEach((r, i) => db.trips.set(`w${i}`, { _id: `w${i}`, truckId: t.id, truckNumber: t.truckNumber, businessDate: today, pheeraNo: i + 1, materialCategory: "BRICKS", materialName: "Bricks", materialKey: "bricks", destination: "Palghar", destinationKey: "palghar", quantity: r.quantity, unit: "bricks", submissionId: body.submissionId, clientRowId: r.clientRowId, isDeleted: false, history: [], revision: 1, createdAt: new Date(), updatedAt: new Date() }));
      db.resnapshot();
    };
    const res = await batch(t, today, rows, body);
    expect(res.status).toBe(200);
    expect(res.body.meta.duplicate).toBe(true);
    expect(db.trips.size).toBe(2);
  });

  it("two genuine, identical trips without a submissionId are both saved (content alone is not a duplicate)", async () => {
    const t = await addTruck();
    await saved(t, today, [bricks(1000, "Palghar"), bricks(1000, "Palghar")]);
    expect(numbers(t, today)).toEqual([1, 2]);
  });

  it("a single save rejects an array, and a batch rejects bad shapes", async () => {
    const t = await addTruck();
    expect((await asOwner("post", "/api/truck-trips", [{ truckId: t.id, businessDate: today, ...bricks(100) }])).status).toBe(400);
    for (const body of [{ truckId: t.id, businessDate: today, trips: [] }, { truckId: t.id, businessDate: today, trips: Array(51).fill(bricks(1)) }, { truckId: t.id, businessDate: today, trips: [bricks(1)], extra: 1 }, { truckId: t.id, businessDate: today, trips: [{ ...bricks(1), pheeraNo: 7 }] }, { truckId: t.id, businessDate: today, trips: [{ ...bricks(1), clientRowId: "a" }, { ...bricks(2), clientRowId: "a" }] }, { truckId: "nope", businessDate: today, trips: [bricks(1)] }]) {
      expect((await asOwner("post", "/api/truck-trips/batch", body)).status, JSON.stringify(body).slice(0, 80)).toBe(400);
    }
    expect(db.trips.size).toBe(0);
  });

  it("refuses an unknown truck and a future date, and uses the Indian day", async () => {
    const t = await addTruck();
    expect((await asOwner("post", "/api/truck-trips", { truckId: "aaaaaaaaaaaaaaaaaaaaaaaa", businessDate: today, ...bricks(1) })).status).toBe(400);
    expect((await one(t, addDays(today, 1), bricks(100))).status).toBe(400);
    for (const bad of ["2026-02-30", "yesterday", "03-11-2026"]) expect((await one(t, bad, bricks(100))).status, bad).toBe(400);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-02T18:15:00Z")); // 23:45 on 2 Nov in India
    owner = addUser("OWNER");
    expect((await one(t, "2026-11-03", bricks(100))).status).toBe(400);
    expect((await one(t, "2026-11-02", bricks(100))).status).toBe(201);
    vi.setSystemTime(new Date("2026-11-02T18:45:00Z")); // 00:15 on 3 Nov in India
    owner = addUser("OWNER");
    expect((await one(t, "2026-11-03", bricks(100))).status).toBe(201);
  });

  it("a stopped or in-maintenance truck can still have Pheera recorded (for past days)", async () => {
    const t = await addTruck();
    await setStatus(t, { status: "STOPPED", reason: "BREAKDOWN" });
    expect((await one(t, D(1), bricks(100))).status).toBe(201);
  });
});

// ---------------------------------------------------------------------------
describe("materials and quantities", () => {
  it("Bricks: a positive whole number, unit bricks", async () => {
    const t = await addTruck();
    expect((await one(t, today, bricks(1000))).body.data).toMatchObject({ materialName: "Bricks", quantity: 1000, unit: "bricks" });
    for (const quantity of [0, -5, 1.5, 999.9, 100001, "1000", null, NaN]) expect((await one(t, today, bricks(quantity))).status, String(quantity)).toBe(400);
    expect((await one(t, today, bricks(100000))).status).toBe(201);
  });

  it("rejects decimal bricks with a clear message", async () => {
    const t = await addTruck();
    const res = await one(t, today, bricks(10.5));
    expect(res.body.errors[0]).toMatchObject({ field: "quantity", message: "Bricks must be a whole number" });
  });

  it("Soil: decimal tonnes allowed, unit tonnes", async () => {
    const t = await addTruck();
    expect((await one(t, today, soil(7.25))).body.data).toMatchObject({ materialName: "Soil", quantity: 7.25, unit: "tonnes", quantityLabel: "Weight (Tonnes)" });
    expect((await one(t, today, soil(5))).status).toBe(201);
    for (const quantity of [0, -1, 1.2345, 100.001, "5"]) expect((await one(t, today, soil(quantity))).status, String(quantity)).toBe(400);
  });

  it("Other: saves the REAL material name, such as Stone Dust, and returns it", async () => {
    const t = await addTruck();
    const res = await one(t, today, other("Stone Dust", 2.5));
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ materialCategory: "OTHER", materialName: "Stone Dust", quantity: 2.5, unit: "tonnes", quantityLabel: "Weight (Tonnes)" });
    expect([...db.trips.values()][0]).toMatchObject({ materialName: "Stone Dust", materialKey: "stone dust" });
    expect((await list()).data[0].materialName).toBe("Stone Dust");
    expect((await asOwner("get", `/api/truck-trips/${res.body.data.id}`)).body.data.materialName).toBe("Stone Dust");
  });

  it("trims and tidies the custom name, and rejects an empty, missing, too short, too long or reserved name", async () => {
    const t = await addTruck();
    expect((await one(t, today, other("   Stone    Dust  ", 1))).body.data.materialName).toBe("Stone Dust");
    for (const customMaterialName of ["", "   ", "a", "x".repeat(41), "Bricks", "SOIL", " soil "]) expect((await one(t, today, other(customMaterialName, 1))).status, JSON.stringify(customMaterialName)).toBe(400);
    expect((await one(t, today, { material: "OTHER", destination: "Palghar", quantity: 1 })).status).toBe(400);
    expect((await one(t, today, { material: "OTHER", customMaterialName: null, destination: "Palghar", quantity: 1 })).status).toBe(400);
    expect(db.trips.size).toBe(1);
  });

  it("a custom name is only for Other, and the unit must match the material", async () => {
    const t = await addTruck();
    expect((await one(t, today, bricks(10, "Palghar", { customMaterialName: "Sand" }))).status).toBe(400);
    expect((await one(t, today, soil(1, "Palghar", { customMaterialName: "Sand" }))).status).toBe(400);
    expect((await one(t, today, bricks(10, "Palghar", { unit: "tonnes" }))).status).toBe(400);
    expect((await one(t, today, soil(1, "Palghar", { unit: "bricks" }))).status).toBe(400);
    expect((await one(t, today, other("Sand", 1, "Palghar", { unit: "bricks" }))).status).toBe(400);
    expect((await one(t, today, bricks(10, "Palghar", { unit: "bricks" }))).status).toBe(201);
    expect((await one(t, today, { ...soil(1), material: "SAND" })).status).toBe(400);
  });

  it("needs a real destination", async () => {
    const t = await addTruck();
    for (const destination of ["", "  ", "A", "x".repeat(61)]) expect((await one(t, today, bricks(10, destination))).status, JSON.stringify(destination)).toBe(400);
    expect((await one(t, today, bricks(10, "  Manor   East "))).body.data.destination).toBe("Manor East");
  });

  it("older records (Sand, Cement, Stone) stay readable, filterable and editable", async () => {
    const t = await addTruck();
    const legacy = (id, no, name, quantity) => db.trips.set(id, { _id: id, truckId: t.id, truckNumber: t.truckNumber, businessDate: D(30), pheeraNo: no, materialCategory: "OTHER", materialName: name, materialKey: name.toLowerCase(), destination: "Manor", destinationKey: "manor", quantity, unit: "tonnes", remarks: "", isDeleted: false, history: [], revision: 1, createdAt: new Date(), updatedAt: new Date(), createdByName: "Ramesh Patel" });
    legacy("a1b2c3d4e5f60718293a4b01", 1, "Sand", 6);
    legacy("a1b2c3d4e5f60718293a4b02", 2, "Cement", 2.5);
    legacy("a1b2c3d4e5f60718293a4b03", 3, "Stone", 4);
    const rows = (await list(`?truckId=${t.id}`)).data;
    expect(rows.map((r) => [r.materialName, r.quantity, r.unit])).toEqual([["Sand", 6, "tonnes"], ["Cement", 2.5, "tonnes"], ["Stone", 4, "tonnes"]]);
    expect((await list("?materialName=sand")).data).toHaveLength(1);
    const edit = await asOwner("patch", "/api/truck-trips/a1b2c3d4e5f60718293a4b01", { remarks: "old load", quantity: 6.5, reason: "Weighed again" });
    expect(edit.status).toBe(200);
    expect(edit.body.data).toMatchObject({ materialName: "Sand", quantity: 6.5, unit: "tonnes", remarks: "old load" });
    const mat = await report("material");
    expect(mat.groups.map((g) => [g.label, g.tonnes, g.bricks])).toEqual([["Cement", 2.5, 0], ["Sand", 6.5, 0], ["Stone", 4, 0]]);
    expect((await saved(t, today, [bricks(500)]))[0].pheeraNo).toBe(1); // new day, new numbering, alongside old records
  });

  it("changing the material needs the quantity again, checked against the NEW unit", async () => {
    const t = await addTruck();
    const [sand, load] = await saved(t, today, [other("Sand", 6), bricks(1000)]);
    const patch = (id, body) => asOwner("patch", `/api/truck-trips/${id}`, { reason: "Wrong material", ...body });
    const noQty = await patch(sand.id, { material: "BRICKS" });
    expect(noQty.status).toBe(400);
    expect(noQty.body.errors[0]).toMatchObject({ field: "quantity" });
    expect((await patch(sand.id, { material: "BRICKS", quantity: 6.5 })).status).toBe(400); // decimals are not bricks
    expect((await patch(load.id, { material: "SOIL" })).status).toBe(400); // 1000 would silently become 1000 tonnes
    expect((await patch(load.id, { material: "SOIL", quantity: 1000 })).status).toBe(400); // over the tonnes limit
    expect((await patch(load.id, { material: "OTHER", customMaterialName: "Bricks", quantity: 2 })).status).toBe(400);
    expect((await patch(load.id, { customMaterialName: "Gravel" })).status).toBe(400); // name needs its material
    expect([...db.trips.values()].map((r) => [r.materialName, r.quantity])).toEqual([["Sand", 6], ["Bricks", 1000]]);
    const ok = await patch(sand.id, { material: "BRICKS", quantity: 600 });
    expect(ok.body.data).toMatchObject({ materialName: "Bricks", quantity: 600, unit: "bricks", pheeraNo: 1, revision: 2 });
    const back = await patch(load.id, { material: "OTHER", customMaterialName: "Gravel", quantity: 3.5 });
    expect(back.body.data).toMatchObject({ materialName: "Gravel", quantity: 3.5, unit: "tonnes" });
  });

  it("re-sending the same material without a quantity changes nothing, and a quantity alone is checked against the unit", async () => {
    const t = await addTruck();
    const [b, s] = await saved(t, today, [bricks(1000), soil(2)]);
    const same = await asOwner("patch", `/api/truck-trips/${b.id}`, { material: "BRICKS", destination: "Boisar", reason: "Wrong place" });
    expect(same.body.data).toMatchObject({ materialName: "Bricks", quantity: 1000, destination: "Boisar", revision: 2 });
    expect((await asOwner("patch", `/api/truck-trips/${b.id}`, { quantity: 10.5, reason: "Miscounted" })).status).toBe(400);
    expect((await asOwner("patch", `/api/truck-trips/${s.id}`, { quantity: 2.0001, reason: "Miscounted" })).status).toBe(400);
    expect((await asOwner("patch", `/api/truck-trips/${s.id}`, { unit: "bricks", quantity: 3, reason: "Miscounted" })).status).toBe(400);
  });

  it("corrections keep the old values in an audit trail, and a no-op is not a new revision", async () => {
    const t = await addTruck();
    const [p] = await saved(t, today, [bricks(1000, "Palghar", { remarks: "a" })]);
    await asOwner("patch", `/api/truck-trips/${p.id}`, { quantity: 1100, reason: "Miscounted" });
    await asOwner("patch", `/api/truck-trips/${p.id}`, { destination: "Boisar", remarks: "b", reason: "Wrong place" });
    const same = await asOwner("patch", `/api/truck-trips/${p.id}`, { quantity: 1100, reason: "No change" });
    expect(same.body.data.revision).toBe(3);
    const detail = (await asOwner("get", `/api/truck-trips/${p.id}`)).body.data;
    expect(detail.audit.map((a) => [a.action, a.reason, a.before.quantity, a.before.destination])).toEqual([["CORRECT", "Miscounted", 1000, "Palghar"], ["CORRECT", "Wrong place", 1100, "Palghar"]]);
    expect(detail.audit[0]).toMatchObject({ by: "Ramesh Patel", revision: 1 });
  });

  it("a correction needs a reason and at least one field; a voided Pheera cannot be corrected or voided again", async () => {
    const t = await addTruck();
    const [p] = await saved(t, today, [bricks(1000)]);
    for (const body of [{ quantity: 5 }, { reason: "Miscounted" }, { quantity: 5, reason: "x" }]) expect((await asOwner("patch", `/api/truck-trips/${p.id}`, body)).status, JSON.stringify(body)).toBe(400);
    expect((await asOwner("delete", `/api/truck-trips/${p.id}`, {})).status).toBe(400);
    const voided = await asOwner("delete", `/api/truck-trips/${p.id}`, { reason: "Wrong truck" });
    expect(voided.body.data).toMatchObject({ isVoided: true, voidReason: "Wrong truck", voidedBy: "Ramesh Patel", pheeraNo: 1, quantity: 1000 });
    expect(voided.body.data.audit.at(-1)).toMatchObject({ action: "VOID", reason: "Wrong truck" });
    expect((await asOwner("patch", `/api/truck-trips/${p.id}`, { quantity: 5, reason: "Miscounted" })).status).toBe(409);
    expect((await asOwner("delete", `/api/truck-trips/${p.id}`, { reason: "Wrong truck" })).status).toBe(409);
    expect((await asOwner("get", "/api/truck-trips/aaaaaaaaaaaaaaaaaaaaaaaa")).status).toBe(404);
    expect((await asOwner("get", "/api/truck-trips/nope")).status).toBe(400);
  });

  it("a change made between our read and our write is a conflict, never a lost update", async () => {
    const t = await addTruck();
    const [p] = await saved(t, today, [bricks(1000)]);
    const TruckTrip = (await import("../models/TruckTrip.js")).default;
    const original = TruckTrip.updateOne;
    TruckTrip.updateOne = async (...args) => {
      TruckTrip.updateOne = original;
      const row = [...db.trips.values()][0];
      row.revision += 1;
      row.quantity = 7777;
      return original(...args);
    };
    expect((await asOwner("patch", `/api/truck-trips/${p.id}`, { quantity: 1200, reason: "Miscounted" })).status).toBe(409);
    expect([...db.trips.values()][0].quantity).toBe(7777);
  });

  it("bricks and tonnes are never added together", async () => {
    const t = await addTruck();
    await saved(t, today, [bricks(1000), bricks(500), soil(2.5), other("Stone Dust", 1.25)]);
    const res = await list();
    expect(res.meta.summary).toEqual({ trips: 4, bricks: 1500, tonnes: 3.75 });
    expect(Object.keys(res.meta.summary).sort()).toEqual(["bricks", "tonnes", "trips"]); // no combined "quantity"
    const groups = (await report("material")).groups;
    expect(groups.find((g) => g.label === "Bricks")).toMatchObject({ unit: "bricks", quantity: 1500, bricks: 1500, tonnes: 0 });
    expect(groups.find((g) => g.label === "Soil")).toMatchObject({ unit: "tonnes", quantity: 2.5, bricks: 0, tonnes: 2.5 });
    expect(groups.find((g) => g.label === "Stone Dust")).toMatchObject({ unit: "tonnes", quantity: 1.25 });
    const mixed = groupTrips([{ quantity: 10, unit: "bricks", k: "a" }, { quantity: 2, unit: "tonnes", k: "a" }], (r) => r.k, (r) => r.k);
    expect(mixed[0]).toMatchObject({ bricks: 10, tonnes: 2, unit: null, quantity: null });
  });

  it("tonnes add up exactly, with no floating-point drift", () => {
    const rows = [0.1, 0.2, 0.3, 1.005, 2.995].map((quantity) => ({ quantity, unit: "tonnes" }));
    expect(summarizeTrips(rows)).toEqual({ trips: 5, bricks: 0, tonnes: 4.6 });
    expect(quantityError(2.5004, "tonnes")).not.toBeNull(); // more than 3 decimals
    expect(quantityError(2.5, "tonnes")).toBeNull();
    expect(resolveTripMaterial({ material: "OTHER", customMaterialName: "Stone Dust", quantity: 2.5 }).value).toMatchObject({ materialName: "Stone Dust", materialKey: "stone dust", unit: "tonnes" });
    expect(truckNumberKey("mh-04 ab/1234")).toBe("MH04AB1234");
  });
});

// ---------------------------------------------------------------------------
describe("history and filters", () => {
  // t1: D2 Bricks 1000 Palghar, Bricks 1500 Boisar, Soil 5 Palghar | D1 Stone Dust 2.5 Manor
  // t2: D1 Bricks 2000 Palghar, Soil 4.25 Boisar | D0 Stone Dust 3 Palghar, Bricks 500 Manor (voided)
  const fleet = async () => {
    const [t1, t2, t3] = [await addTruck({ truckNumber: "MH-04-AB-1001" }), await addTruck({ truckNumber: "MH-04-CD-2002" }), await addTruck({ truckNumber: "MH-12-EF-3003" })];
    await saved(t1, D(2), [bricks(1000, "Palghar"), bricks(1500, "Boisar"), soil(5, "Palghar")]);
    await saved(t1, D(1), [other("Stone Dust", 2.5, "Manor")]);
    await saved(t2, D(1), [bricks(2000, "Palghar"), soil(4.25, "Boisar")]);
    const day0 = await saved(t2, D(0), [other("Stone Dust", 3, "Palghar"), bricks(500, "Manor")]);
    await asOwner("delete", `/api/truck-trips/${day0[1].id}`, { reason: "Wrong truck" });
    return { t1, t2, t3 };
  };
  const ids = (res) => res.data.map((r) => `${r.truckNumber.slice(-4)}:${r.businessDate === today ? 0 : (new Date(today) - new Date(r.businessDate)) / 864e5}:${r.pheeraNo}`);

  it("returns every individual Pheera, newest first, with the totals of all matches", async () => {
    await fleet();
    const res = await list();
    expect(res.data).toHaveLength(7);
    expect(ids(res)).toEqual(["2002:0:1", "1001:1:1", "2002:1:1", "2002:1:2", "1001:2:1", "1001:2:2", "1001:2:3"]);
    expect(res.meta).toMatchObject({ total: 7, page: 1, limit: 100, summary: { trips: 7, bricks: 4500, tonnes: 14.75 } });
    const first = res.data.find((r) => r.truckNumber === "MH-04-AB-1001" && r.pheeraNo === 2);
    expect(first).toMatchObject({ materialName: "Bricks", destination: "Boisar", quantity: 1500, unit: "bricks" });
  });

  it("pages, with totals that still cover every match", async () => {
    await fleet();
    const p1 = await list("?limit=3");
    const p3 = await list("?limit=3&page=3");
    expect([p1.data.length, p3.data.length, p1.meta.total]).toEqual([3, 1, 7]);
    expect(p1.meta.summary.trips).toBe(7);
  });

  it("filters by truck, by registration (ignoring case, spaces and hyphens), by material, by actual name and by destination", async () => {
    const { t1 } = await fleet();
    expect((await list(`?truckId=${t1.id}`)).data).toHaveLength(4);
    for (const registration of ["MH-04-AB-1001", "mh04ab1001", "ab 1001", "1001", "mh04ab"]) expect((await list(`?registration=${encodeURIComponent(registration)}`)).data.length, registration).toBe(4);
    expect((await list("?registration=MH04")).data).toHaveLength(7);
    expect((await list("?registration=MH12")).data).toHaveLength(0);
    expect((await list("?registration=.*")).data).toHaveLength(0); // text is never treated as a pattern
    expect((await list("?material=BRICKS")).data).toHaveLength(3);
    expect((await list("?material=SOIL")).data).toHaveLength(2);
    expect((await list("?material=OTHER")).data).toHaveLength(2);
    expect((await list("?materialName=stone%20dust")).data).toHaveLength(2);
    expect((await list("?materialName=Stone%20%20DUST")).data).toHaveLength(2);
    expect((await list("?materialName=Stone")).data).toHaveLength(0);
    expect((await list("?destination=palghar")).data).toHaveLength(4);
    expect((await list("?destination=%20PALGHAR%20")).data).toHaveLength(4);
    expect((await list("?destination=Vasai")).data).toHaveLength(0);
  });

  it("filters by a single date and by an inclusive date range, and never includes anything outside it", async () => {
    await fleet();
    expect((await list(`?date=${D(2)}`)).data).toHaveLength(3);
    expect((await list(`?date=${D(1)}`)).data).toHaveLength(3);
    expect((await list(`?from=${D(2)}&to=${D(1)}`)).data).toHaveLength(6);
    expect((await list(`?from=${D(1)}&to=${D(1)}`)).data).toHaveLength(3);
    expect((await list(`?from=${D(1)}`)).data).toHaveLength(4);
    expect((await list(`?to=${D(2)}`)).data).toHaveLength(3);
    const range = await list(`?from=${D(2)}&to=${D(1)}`);
    expect(range.data.every((r) => r.businessDate >= D(2) && r.businessDate <= D(1))).toBe(true);
    expect((await list(`?from=${D(10)}&to=${D(5)}`)).data).toHaveLength(0);
  });

  it("combines filters (all must match)", async () => {
    const { t1, t2 } = await fleet();
    expect((await list(`?truckId=${t2.id}&material=BRICKS&destination=palghar`)).data.map((r) => r.quantity)).toEqual([2000]);
    expect((await list(`?truckId=${t1.id}&materialName=stone dust&from=${D(2)}&to=${D(1)}`)).data).toHaveLength(1);
    expect((await list(`?truckId=${t1.id}&date=${D(0)}`)).data).toHaveLength(0);
    expect((await list(`?registration=2002&destination=boisar&material=SOIL&date=${D(1)}`)).data).toHaveLength(1);
    const res = await list(`?material=BRICKS&destination=palghar&from=${D(2)}&to=${D(0)}`);
    expect(res.meta.summary).toEqual({ trips: 2, bricks: 3000, tonnes: 0 });
  });

  it("hides voided Pheera unless asked, and their totals never count", async () => {
    await fleet();
    expect((await list(`?date=${D(0)}`)).data).toHaveLength(1);
    const all = await list(`?date=${D(0)}&includeVoided=true`);
    expect(all.data).toHaveLength(2);
    expect(all.data.find((r) => r.isVoided)).toMatchObject({ pheeraNo: 2, voidReason: "Wrong truck", quantity: 500 });
    expect(all.meta.summary).toEqual({ trips: 1, bricks: 0, tonnes: 3 });
  });

  it("the day view lists a day's Pheera in truck and Pheera order with the day's totals", async () => {
    const { t1 } = await fleet();
    const day = (await asOwner("get", `/api/truck-trips/day?date=${D(1)}`)).body.data;
    expect(day.items.map((r) => `${r.truckNumber.slice(-4)}:${r.pheeraNo}`)).toEqual(["1001:1", "2002:1", "2002:2"]);
    expect(day.summary).toEqual({ trips: 3, bricks: 2000, tonnes: 6.75 });
    expect((await asOwner("get", `/api/truck-trips/day?date=${D(2)}&truckId=${t1.id}`)).body.data.items).toHaveLength(3);
    expect((await asOwner("get", "/api/truck-trips/day")).status).toBe(400);
  });

  it("offers the standard materials plus every material and destination actually used", async () => {
    await fleet();
    const o = (await asOwner("get", "/api/truck-trips/options")).body.data;
    expect(o.materials.map((m) => [m.name, m.category, m.unit])).toEqual([["Bricks", "BRICKS", "bricks"], ["Soil", "SOIL", "tonnes"], ["Stone Dust", "OTHER", "tonnes"]]);
    expect(o.destinations.map((d) => d.name)).toEqual(["Boisar", "Manor", "Palghar"]);
  });

  it("rejects contradictory or unknown filters", async () => {
    for (const q of [`?date=${today}&from=${today}`, `?from=${today}&to=${D(3)}`, "?material=SAND", "?truckId=nope", "?x=1", "?limit=0", "?limit=501", "?from=2026-02-30"]) expect((await asOwner("get", `/api/truck-trips${q}`)).status, q).toBe(400);
  });
});

// ---------------------------------------------------------------------------
describe("truck reports", () => {
  const fleet = async () => {
    const [t1, t2, t3] = [await addTruck({ truckNumber: "MH-04-AB-1001" }), await addTruck({ truckNumber: "MH-04-CD-2002" }), await addTruck({ truckNumber: "MH-12-EF-3003" })];
    await saved(t1, D(2), [bricks(1000, "Palghar"), bricks(1500, "Boisar"), soil(5, "Palghar")]);
    await saved(t1, D(1), [other("Stone Dust", 2.5, "Manor")]);
    await saved(t2, D(1), [bricks(2000, "Palghar"), soil(4.25, "Boisar")]);
    const day0 = await saved(t2, D(0), [other("Stone Dust", 3, "Palghar"), bricks(500, "Manor")]);
    await asOwner("delete", `/api/truck-trips/${day0[1].id}`, { reason: "Wrong truck" });
    return { t1, t2, t3 };
  };
  const line = (groups, label) => groups.find((g) => g.label === label);

  it("1. individual truck report: every Pheera of the truck, by day, with material and destination breakdowns", async () => {
    const { t1 } = await fleet();
    const r = await report(`truck/${t1.id}`);
    expect(r).toMatchObject({ report: "TRUCK", truck: { id: t1.id, truckNumber: "MH-04-AB-1001" }, totals: { trips: 4, bricks: 2500, tonnes: 7.5 } });
    expect(r.records.map((x) => [x.businessDate, x.pheeraNo, x.materialName, x.destination, x.quantity, x.unit])).toEqual([
      [D(2), 1, "Bricks", "Palghar", 1000, "bricks"], [D(2), 2, "Bricks", "Boisar", 1500, "bricks"], [D(2), 3, "Soil", "Palghar", 5, "tonnes"], [D(1), 1, "Stone Dust", "Manor", 2.5, "tonnes"],
    ]);
    expect(r.groups.map((g) => [g.label, g.trips, g.bricks, g.tonnes])).toEqual([[D(2), 3, 2500, 5], [D(1), 1, 0, 2.5]]);
    expect(r.breakdowns.materials.map((g) => [g.label, g.trips, g.quantity, g.unit])).toEqual([["Bricks", 2, 2500, "bricks"], ["Soil", 1, 5, "tonnes"], ["Stone Dust", 1, 2.5, "tonnes"]]);
    expect(r.breakdowns.destinations.map((g) => [g.label, g.trips])).toEqual([["Boisar", 1], ["Manor", 1], ["Palghar", 2]]);
    const narrowed = await report(`truck/${t1.id}`, `?from=${D(1)}&to=${D(1)}`);
    expect(narrowed.totals).toEqual({ trips: 1, bricks: 0, tonnes: 2.5 });
    expect(narrowed.filters).toEqual({ from: D(1), to: D(1), truckId: t1.id });
    expect((await asOwner("get", "/api/truck-reports/truck/aaaaaaaaaaaaaaaaaaaaaaaa")).status).toBe(404);
    expect((await asOwner("get", "/api/truck-reports/truck/nope")).status).toBe(400);
  });

  it("2. daily report: one day, by truck", async () => {
    await fleet();
    const r = await report("daily", `?date=${D(1)}`);
    expect(r.report).toBe("DAILY");
    expect(r.records).toHaveLength(3);
    expect(r.totals).toEqual({ trips: 3, bricks: 2000, tonnes: 6.75 });
    expect(r.groups.map((g) => [g.label, g.trips, g.bricks, g.tonnes, g.unit, g.quantity])).toEqual([["MH-04-AB-1001", 1, 0, 2.5, "tonnes", 2.5], ["MH-04-CD-2002", 2, 2000, 4.25, null, null]]);
    expect((await report("daily", `?date=${D(0)}`)).totals).toEqual({ trips: 1, bricks: 0, tonnes: 3 }); // the voided Pheera is left out
    expect((await report("daily", `?date=${D(5)}`)).totals).toEqual({ trips: 0, bricks: 0, tonnes: 0 });
    for (const q of ["", `?from=${today}`, `?date=${today}&from=${today}`, `?date=nope`]) expect((await asOwner("get", `/api/truck-reports/daily${q}`)).status, q).toBe(400);
  });

  it("3. date-range report: by day, and nothing outside the range", async () => {
    await fleet();
    const r = await report("range", `?from=${D(2)}&to=${D(1)}`);
    expect(r.report).toBe("RANGE");
    expect(r.totals).toEqual({ trips: 6, bricks: 4500, tonnes: 11.75 });
    expect(r.groups.map((g) => [g.label, g.trips, g.bricks, g.tonnes])).toEqual([[D(2), 3, 2500, 5], [D(1), 3, 2000, 6.75]]);
    expect(r.records.every((x) => x.businessDate >= D(2) && x.businessDate <= D(1))).toBe(true);
    expect(r.breakdowns.trucks.map((g) => [g.label, g.trips])).toEqual([["MH-04-AB-1001", 4], ["MH-04-CD-2002", 2]]);
    expect(r.filters).toEqual({ from: D(2), to: D(1) });
    for (const q of ["", `?from=${D(2)}`, `?to=${D(1)}`, `?from=${today}&to=${D(3)}`]) expect((await asOwner("get", `/api/truck-reports/range${q}`)).status, q).toBe(400);
  });

  it("4. material-wise: each material, including every custom one, on its own line in its own unit", async () => {
    await fleet();
    const r = await report("material");
    expect(r.groups.map((g) => [g.label, g.category, g.trips, g.quantity, g.unit])).toEqual([["Bricks", "BRICKS", 3, 4500, "bricks"], ["Soil", "SOIL", 2, 9.25, "tonnes"], ["Stone Dust", "OTHER", 2, 5.5, "tonnes"]]);
    expect(r.totals).toEqual({ trips: 7, bricks: 4500, tonnes: 14.75 });
    expect(line(r.groups, "Bricks")).toMatchObject({ bricks: 4500, tonnes: 0 });
    const narrowed = await report("material", "?destination=palghar");
    expect(narrowed.groups.map((g) => [g.label, g.trips, g.quantity])).toEqual([["Bricks", 2, 3000], ["Soil", 1, 5], ["Stone Dust", 1, 3]]);
    expect((await report("material", `?from=${D(1)}&to=${D(1)}&materialName=stone dust`)).groups.map((g) => [g.label, g.quantity])).toEqual([["Stone Dust", 2.5]]);
  });

  it("5. destination-wise: separate bricks and tonnes per destination", async () => {
    await fleet();
    const r = await report("destination");
    expect(r.groups.map((g) => [g.label, g.trips, g.bricks, g.tonnes])).toEqual([["Boisar", 2, 1500, 4.25], ["Manor", 1, 0, 2.5], ["Palghar", 4, 3000, 8]]);
    expect(r.totals).toEqual({ trips: 7, bricks: 4500, tonnes: 14.75 });
    expect((await report("destination", "?material=BRICKS")).groups.map((g) => [g.label, g.bricks, g.tonnes])).toEqual([["Boisar", 1500, 0], ["Palghar", 3000, 0]]);
  });

  it("6. all trucks combined: one line per truck (idle trucks show zero) and the fleet total", async () => {
    const { t1, t2, t3 } = await fleet();
    const r = await report("all-trucks");
    expect(r.groups.map((g) => [g.label, g.trips, g.bricks, g.tonnes])).toEqual([["MH-04-AB-1001", 4, 2500, 7.5], ["MH-04-CD-2002", 3, 2000, 7.25], ["MH-12-EF-3003", 0, 0, 0]]);
    expect(r.totals).toEqual({ trips: 7, bricks: 4500, tonnes: 14.75 });
    expect(r.groups.reduce((t, g) => t + g.trips, 0)).toBe(r.totals.trips);
    expect(r.groups.reduce((t, g) => t + g.bricks, 0)).toBe(r.totals.bricks);
    expect(r.breakdowns.materials).toHaveLength(3);
    expect((await report("all-trucks", `?from=${D(0)}&to=${D(0)}`)).groups.map((g) => [g.label, g.trips])).toEqual([["MH-04-AB-1001", 0], ["MH-04-CD-2002", 1], ["MH-12-EF-3003", 0]]);
    expect((await report("all-trucks", `?truckId=${t1.id}`)).groups.map((g) => g.label)).toEqual(["MH-04-AB-1001"]);
    expect(t2.id && t3.id).toBeTruthy();
  });

  it("groups always add up to the totals, and the totals match the Pheera history", async () => {
    await fleet();
    const hist = (await list()).meta.summary;
    for (const name of ["material", "destination", "all-trucks"]) {
      const r = await report(name);
      expect(r.totals, name).toEqual(hist);
      expect(r.groups.reduce((t, g) => t + g.trips, 0), name).toBe(hist.trips);
      expect(r.groups.reduce((t, g) => t + g.bricks, 0), name).toBe(hist.bricks);
      expect(Math.round(r.groups.reduce((t, g) => t + g.tonnes * 1000, 0)) / 1000, name).toBe(hist.tonnes);
    }
  });

  it("is export-ready: individual records with every column, the filters applied, and no combined quantity", async () => {
    await fleet();
    const r = await report("range", `?from=${D(2)}&to=${D(1)}&destination=palghar`);
    expect(r.columns.map((c) => c.key)).toEqual(["businessDate", "truckNumber", "pheeraNo", "materialName", "destination", "quantity", "unit", "remarks"]);
    expect(r.filters).toEqual({ destination: "palghar", from: D(2), to: D(1) });
    expect(r.title).toContain(D(2));
    for (const rec of r.records) for (const c of r.columns) expect(rec, c.key).toHaveProperty(c.key);
    expect(r.records.map((x) => [x.truckNumber, x.pheeraNo, x.materialName, x.quantity, x.unit])).toEqual([["MH-04-AB-1001", 1, "Bricks", 1000, "bricks"], ["MH-04-AB-1001", 3, "Soil", 5, "tonnes"], ["MH-04-CD-2002", 1, "Bricks", 2000, "bricks"]]);
    expect(Object.keys(r.totals).sort()).toEqual(["bricks", "tonnes", "trips"]);
    for (const g of r.groups) expect(Object.keys(g)).not.toContain("total");
  });

  it("the registration number in a report is the snapshot taken when the Pheera was saved", async () => {
    const t = await addTruck({ truckNumber: "MH-04-AB-1001" });
    await saved(t, today, [bricks(100)]);
    await asOwner("patch", `/api/trucks/${t.id}`, { truckNumber: "MH-04-ZZ-9999" });
    expect((await report("daily", `?date=${today}`)).records[0].truckNumber).toBe("MH-04-AB-1001");
    expect((await report(`truck/${t.id}`)).truck.truckNumber).toBe("MH-04-ZZ-9999");
  });

  it("rejects unknown or contradictory report filters", async () => {
    await fleet();
    for (const q of ["?x=1", "?material=SAND", `?from=${today}&to=${D(2)}`, "?truckId=nope", "?includeVoided=true"]) expect((await asOwner("get", `/api/truck-reports/material${q}`)).status, q).toBe(400);
  });
});

// ---------------------------------------------------------------------------
describe("trucks and Pheera are separate from every other module", () => {
  it("saving, correcting, voiding, stopping and reporting change nothing in labour, attendance, work, production, payments or seasons", async () => {
    const driver = await makeLabour("BIGARI");
    await asOwner("post", "/api/seasons", { name: "Season 2026-27", startDate: D(90) });
    const before = otherModulesSnapshot();
    const t = await addTruck({ driverId: driver.id });
    const [a, b] = await saved(t, today, [bricks(1000), other("Stone Dust", 2.5)]);
    await asOwner("patch", `/api/truck-trips/${a.id}`, { quantity: 1100, reason: "Miscounted" });
    await asOwner("delete", `/api/truck-trips/${b.id}`, { reason: "Wrong truck" });
    await setStatus(t, { status: "STOPPED", reason: "BREAKDOWN" });
    await asOwner("patch", `/api/trucks/${t.id}`, { driverId: null });
    await report("all-trucks");
    expect(otherModulesSnapshot()).toBe(before);
  });

  it("truck quantities never reach salary or balances", async () => {
    const driver = await makeLabour("BIGARI");
    const t = await addTruck({ driverId: driver.id });
    await saved(t, today, [bricks(5000), soil(20)]);
    expect((await asOwner("get", `/api/labours/${driver.id}/balance`)).body.data).toMatchObject({ earned: 0, balance: 0 });
    expect((await asOwner("get", `/api/salary/${driver.id}`)).body.data.season).toEqual({ earned: 0, received: 0, balance: 0 });
  });

  it("the Pheera and report modules import no labour, attendance, payment, salary, maap or production code", () => {
    const banned = ["labour", "attendance", "payment", "salary", "maap", "production", "season", "balance"];
    for (const file of ["services/truckTrip.service.js", "services/truckReport.service.js", "services/truckTripCalculations.js", "utils/truckRules.js", "controllers/truckTrip.controller.js", "controllers/truckReport.controller.js", "routes/truckTrip.routes.js", "routes/truckReport.routes.js", "models/TruckTrip.js", "validators/truckTrip.validators.js", "validators/truckReport.validators.js"]) {
      const imports = readFileSync(new URL(`../${file}`, import.meta.url), "utf8").split("\n").filter((line) => /^\s*import\b/.test(line)).join("\n").toLowerCase();
      for (const word of banned) expect(imports, `${file} ${word}`).not.toContain(word);
    }
  });

  it("the truck module only reads labour (to check a driver), and never writes it", () => {
    const code = readFileSync(new URL("../services/truck.service.js", import.meta.url), "utf8");
    expect(code).toContain("Labour.find");
    for (const write of ["Labour.create", "Labour.updateOne", "Labour.insertMany", "Labour.deleteOne"]) expect(code).not.toContain(write);
  });

  it("the report modules never write", () => {
    for (const file of ["services/truckReport.service.js", "controllers/truckReport.controller.js", "routes/truckReport.routes.js"]) {
      const code = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
      for (const write of [".create(", ".insertMany(", ".updateOne(", ".updateMany(", ".deleteOne(", ".deleteMany(", ".save(", "router.post", "router.patch", "router.delete"]) expect(code, `${file} ${write}`).not.toContain(write);
    }
  });

  it("no code keeps a Pheera total anywhere (totals are calculated, never stored)", async () => {
    const t = await addTruck();
    await saved(t, today, [bricks(1000), soil(2)]);
    for (const row of db.trips.values()) for (const field of ["total", "totalBricks", "totalTonnes", "tripCount", "count"]) expect(row).not.toHaveProperty(field);
  });
});

// ---------------------------------------------------------------------------
describe("models", () => {
  const truckBase = { truckNumber: "MH-04-AB-1234", truckKey: "MH04AB1234", statusSince: new Date() };
  const truckErrors = (data) => new RealTruck(data).validateSync()?.errors ?? {};
  const tripBase = { truckId: new mongoose.Types.ObjectId(), truckNumber: "MH-04-AB-1234", businessDate: "2026-11-01", pheeraNo: 1, materialCategory: "BRICKS", materialName: "Bricks", materialKey: "bricks", destination: "Palghar", destinationKey: "palghar", quantity: 1000, unit: "bricks" };
  const tripErrors = (data) => new RealTrip({ ...tripBase, ...data }).validateSync()?.errors ?? {};

  it("truck: valid by default as Working; Stopped needs a reason and only Stopped may have one", () => {
    expect(new RealTruck(truckBase).validateSync()).toBeUndefined();
    expect(new RealTruck(truckBase)).toMatchObject({ status: "WORKING", stopReason: null, statusNote: "", nickname: "" });
    expect(truckErrors({ ...truckBase, status: "STOPPED" }).stopReason).toBeDefined();
    expect(truckErrors({ ...truckBase, status: "STOPPED", stopReason: "BREAKDOWN" }).stopReason).toBeUndefined();
    expect(truckErrors({ ...truckBase, status: "WORKING", stopReason: "BREAKDOWN" }).stopReason).toBeDefined();
    expect(truckErrors({ ...truckBase, status: "STOPPED", stopReason: "FLAT" }).stopReason).toBeDefined();
    expect(truckErrors({ ...truckBase, status: "BROKEN" }).status).toBeDefined();
    expect(truckErrors({ ...truckBase, truckKey: "ab" }).truckKey).toBeDefined();
    expect(truckErrors({ ...truckBase, capacity: -1 }).capacity).toBeDefined();
    expect(truckErrors({ ...truckBase, driverId: "X-1" }).driverId).toBeDefined();
    expect(new RealTruck({ ...truckBase, isDeleted: true }).get("isDeleted")).toBeUndefined();
  });

  it("truck: the registration key is a unique index", () => {
    expect(RealTruck.schema.indexes().find(([f]) => f.truckKey === 1)[1]).toMatchObject({ unique: true });
  });

  it("Pheera: valid bricks and tonnes records; the unit must match the material", () => {
    expect(new RealTrip(tripBase).validateSync()).toBeUndefined();
    expect(tripErrors({ materialCategory: "SOIL", materialName: "Soil", materialKey: "soil", unit: "tonnes", quantity: 2.5 })).toEqual({});
    expect(tripErrors({ materialCategory: "OTHER", materialName: "Stone Dust", materialKey: "stone dust", unit: "tonnes", quantity: 2.5 })).toEqual({});
    expect(tripErrors({ unit: "tonnes" }).unit).toBeDefined();
    expect(tripErrors({ materialCategory: "SOIL", materialName: "Soil", unit: "bricks" }).unit).toBeDefined();
    expect(tripErrors({ materialCategory: "OTHER", materialName: "Sand", unit: "bricks", quantity: 5 }).unit).toBeDefined();
  });

  it("Pheera: rejects decimal bricks, bad tonnes, wrong names, bad numbers and unknown fields", () => {
    for (const quantity of [0, -1, 1.5, 100001]) expect(tripErrors({ quantity }).quantity, String(quantity)).toBeDefined();
    for (const quantity of [0, 100.5, 1.2345]) expect(tripErrors({ materialCategory: "SOIL", materialName: "Soil", unit: "tonnes", quantity }).quantity, String(quantity)).toBeDefined();
    expect(tripErrors({ materialName: "Sand" }).materialName).toBeDefined(); // Bricks must be called Bricks
    expect(tripErrors({ materialCategory: "SOIL", materialName: "Gravel", unit: "tonnes", quantity: 1 }).materialName).toBeDefined();
    expect(tripErrors({ materialCategory: "SAND" }).materialCategory).toBeDefined();
    expect(tripErrors({ pheeraNo: 0 }).pheeraNo).toBeDefined();
    expect(tripErrors({ pheeraNo: 1.5 }).pheeraNo).toBeDefined();
    expect(tripErrors({ businessDate: "2026-02-30" }).businessDate).toBeDefined();
    expect(tripErrors({ destination: "" }).destination).toBeDefined();
    expect(tripErrors({ truckId: "nope" }).truckId).toBeDefined();
    expect(new RealTrip({ ...tripBase, total: 5 }).get("total")).toBeUndefined();
    expect(new RealTrip(tripBase)).toMatchObject({ revision: 1, isDeleted: false, remarks: "" });
  });

  it("Pheera: the unique indexes and the filter indexes are declared", () => {
    const indexes = RealTrip.schema.indexes();
    const has = (fields) => indexes.find(([f]) => JSON.stringify(f) === JSON.stringify(fields));
    expect(has({ truckId: 1, businessDate: 1, pheeraNo: 1 })[1]).toMatchObject({ unique: true });
    expect(has({ submissionId: 1, clientRowId: 1 })[1]).toMatchObject({ unique: true, partialFilterExpression: { submissionId: { $type: "string" } } });
    for (const f of [{ businessDate: 1, truckId: 1 }, { materialKey: 1, businessDate: 1 }, { destinationKey: 1, businessDate: 1 }]) expect(has(f), JSON.stringify(f)).toBeDefined();
    expect(RealTrip.schema.path("truckId").options.ref).toBe("Truck");
  });
});
