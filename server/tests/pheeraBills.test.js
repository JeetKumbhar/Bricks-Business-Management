import mongoose from "mongoose";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.NODE_ENV = "test";
  process.env.BCRYPT_ROUNDS = "4";
  process.env.CLIENT_ORIGIN = "http://localhost:5173";
  process.env.JWT_SECRET = "unit-test-secret-that-is-long-enough-0123456789";
});

// No database in tests: real Mongoose schemas validate; an in-memory store replaces only the storage calls.
const { db, makeAttendanceModel, makeCounterModel, makeLabourModel, makeMaapEntryModel, makePaymentModel, makeProductionEntryModel, makeRateModel, makeSeasonModel, makeTruckHistoryModel, makeTruckModel, makeTruckTripModel, makeBillModel, makeInvoiceSettingsModel, makeCustomerModel } = await import("./helpers/memoryDb.js");
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
vi.mock("../models/TruckTrip.js", async (importOriginal) => ({ default: makeTruckTripModel((await importOriginal()).default) }));
vi.mock("../models/Customer.js", async (importOriginal) => ({ default: makeCustomerModel((await importOriginal()).default) }));
vi.mock("../models/Bill.js", async (importOriginal) => ({ default: makeBillModel((await importOriginal()).default) }));
vi.mock("../models/InvoiceSettings.js", async (importOriginal) => ({ default: makeInvoiceSettingsModel((await importOriginal()).default) }));
vi.mock("../utils/transaction.js", () => ({ runInTransaction: (work) => db.transaction(() => work(null)) }));


const { createApp } = await import("../app.js");
const { signAccessToken } = await import("../services/auth.service.js");
const { calculateBill, lineTaxable, pricingUnitFor } = await import("../services/billCalculations.js");
const { todayBusinessDate } = await import("../utils/dates.js");

const ORIGIN = "http://localhost:5173";
const today = () => todayBusinessDate();
const addUser = (role = "OWNER", name = "Ramesh Patel") => {
  const user = { _id: new mongoose.Types.ObjectId().toString(), name, email: `${role.toLowerCase()}@example.com`, role, isActive: true, tokenVersion: 0 };
  users.list.push(user);
  return { user, cookie: `brickpro_token=${signAccessToken(user)}` };
};
let app, owner, manager, truckSeq;
const send = (method, url, cookie, bodyData) => {
  const req = request(app)[method](url).set("Origin", ORIGIN);
  if (cookie) req.set("Cookie", cookie);
  return bodyData === undefined ? req : req.send(bodyData);
};
const asOwner = (method, url, b) => send(method, url, owner.cookie, b);
const asManager = (method, url, b) => send(method, url, manager.cookie, b);
const ok = (res, status = 200) => {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  return res.body.data;
};

const GSTIN_27 = "27ABCDE1234F1Z5";
const sellerSettings = { businessName: "AAYUSH CARTING", businessDescription: "BUILDING MATERIAL SUPPLIER", productsLine: "BRICKS", address: "Sample Road, Sample Town", phones: ["9800000001"], jurisdiction: "Sample", stateName: "Sample State", stateCode: "27", gstin: GSTIN_27, pan: "ABCDE1234F", bank: { bankName: "Sample Bank", branch: "Main", accountNumber: "1234567890", ifsc: "SAMP0000001" }, proprietorName: "Ramesh Patel" };
const configure = async () => ok(await asOwner("patch", "/api/invoice-settings", sellerSettings));

const mkCustomer = async (name = "Shree Constructions", extra = {}) => ok(await asOwner("post", "/api/customers", { name, address: "Plot 12, Vapi", stateName: "Maharashtra", stateCode: "27", ...extra }), 201);
const mkInternal = async () => ok(await asOwner("post", "/api/customers/internal", {}), 201);
const mkTruck = async () => ok(await asOwner("post", "/api/trucks", { truckNumber: `MH-04-AB-${1001 + truckSeq++}` }), 201);
const bricks = (customerId, quantity = 1000, destination = "Palghar") => ({ customerId, material: "BRICKS", destination, quantity });
const soil = (customerId, quantity = 4.5, destination = "Palghar") => ({ customerId, material: "SOIL", destination, quantity });
const mkTrips = async (rows, truck = null) => {
  const t = truck ?? (await mkTruck());
  return ok(await asOwner("post", "/api/truck-trips/batch", { truckId: t.id, businessDate: today(), trips: rows }), 201);
};
let reqSeq = 0;
const generate = (tripIds, requestId = `request-${(reqSeq += 1)}-abcdef`) => asOwner("post", "/api/bills/from-trips", { tripIds, requestId });
const trip = async (id) => ok(await asOwner("get", `/api/truck-trips/${id}`));
const bill = async (id) => ok(await asOwner("get", `/api/bills/${id}`));
const rawTrip = (id) => db.trips.get(id);
// fill rate / hsn / tax rate on every line of a generated draft
const fillDraft = async (b, { rate = 7000, hsn = "6901", taxRate = 5 } = {}) =>
  ok(await asOwner("patch", `/api/bills/${b.id}`, { items: b.items.map((i) => ({ sourceTripId: i.sourceTripId, particulars: i.particulars, hsn, rate, taxRate })) }));
const finalize = (id) => asOwner("post", `/api/bills/${id}/finalize`, { reviewed: true });
const snapshotOthers = () => JSON.stringify([[...db.labours.values()], db.rates, [...db.attendance.values()], [...db.maap.values()], [...db.payments.values()], [...db.trucks.values()]]);

beforeEach(() => {
  db.reset();
  users.list.length = 0;
  truckSeq = 0;
  owner = addUser("OWNER");
  manager = addUser("MANAGER", "Helper");
  app = createApp();
});

// ---------------------------------------------------------------------------
describe("customers", () => {
  it("creates, reads, lists and updates a customer (owner only for writes)", async () => {
    const c = await mkCustomer("Shree Constructions");
    expect(c).toMatchObject({ name: "Shree Constructions", kind: "NORMAL", isInternal: false, isArchived: false, revision: 1 });
    expect(ok(await asManager("get", `/api/customers/${c.id}`)).name).toBe("Shree Constructions");
    expect(ok(await asManager("get", "/api/customers")).length).toBe(1);
    expect((await asManager("post", "/api/customers", { name: "Other Customer" })).status).toBe(403);
    expect((await asManager("patch", `/api/customers/${c.id}`, { address: "x" })).status).toBe(403);
    const u = ok(await asOwner("patch", `/api/customers/${c.id}`, { address: "New address", revision: 1 }));
    expect(u).toMatchObject({ address: "New address", revision: 2 });
    expect((await asOwner("patch", `/api/customers/${c.id}`, { address: "x", revision: 1 })).status).toBe(409);
  });

  it("refuses a duplicate name ignoring case and extra spaces, and shows a clear message", async () => {
    await mkCustomer("Shree Constructions");
    for (const name of ["shree constructions", "  SHREE   Constructions "]) {
      const res = await asOwner("post", "/api/customers", { name });
      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(/already exists/);
    }
    const other = await mkCustomer("Om Builders");
    const clash = await asOwner("patch", `/api/customers/${other.id}`, { name: "SHREE constructions" });
    expect(clash.status).toBe(409);
    expect(db.customers.size).toBe(2);
  });

  it("never silently reuses or reactivates an archived customer's name; restore is the explicit way back", async () => {
    const c = await mkCustomer("Old Customer");
    expect(ok(await asOwner("delete", `/api/customers/${c.id}`, { reason: "No longer buys" })).isArchived).toBe(true);
    expect(ok(await asOwner("get", "/api/customers")).length).toBe(0);
    expect(ok(await asOwner("get", "/api/customers?includeArchived=true")).length).toBe(1);
    const again = await asOwner("post", "/api/customers", { name: "old customer" });
    expect(again.status).toBe(409);
    expect(again.body.message).toMatch(/archived/);
    expect(again.body.message).toContain(`/api/customers/${c.id}/restore`);
    expect(db.customers.size).toBe(1);
    const back = ok(await asOwner("post", `/api/customers/${c.id}/restore`, {}));
    expect(back).toMatchObject({ isArchived: false, name: "Old Customer" });
    expect(back.history.map((h) => h.action)).toEqual(["CREATE", "ARCHIVE", "RESTORE"]);
    expect((await asOwner("post", `/api/customers/${c.id}/restore`, {})).status).toBe(409);
  });

  it("rejects unknown fields and bad details", async () => {
    for (const body of [{ name: "A" }, { name: "Valid Name", kind: "INTERNAL" }, { name: "Valid Name", customerKey: "x" }, { name: "Valid Name", gstin: "BAD" }, { name: "Valid Name", gstin: GSTIN_27, stateCode: "24" }]) {
      expect((await asOwner("post", "/api/customers", body)).status, JSON.stringify(body)).toBe(400);
    }
  });

  it("has a built-in Internal / No Bill customer that is created once and cannot be edited, archived, duplicated or typed as a name", async () => {
    const internal = await mkInternal();
    expect(internal).toMatchObject({ name: "Internal / No Bill", kind: "INTERNAL", isInternal: true });
    expect(ok(await asOwner("post", "/api/customers/internal", {})).id).toBe(internal.id); // idempotent, 200
    expect(db.customers.size).toBe(1);
    expect((await asOwner("patch", `/api/customers/${internal.id}`, { address: "x" })).status).toBe(409);
    expect((await asOwner("delete", `/api/customers/${internal.id}`, { reason: "No longer" })).status).toBe(409);
    expect((await asOwner("post", "/api/customers", { name: "internal / no bill" })).status).toBe(409);
    expect(ok(await asOwner("get", "/api/customers?kind=NORMAL")).length).toBe(0);
    expect((await asManager("post", "/api/customers/internal", {})).status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
describe("Pheera need a customer and get a billing status", () => {
  it("rejects a new Pheera without a valid, active customer", async () => {
    const t = await mkTruck();
    const post = (row) => asOwner("post", "/api/truck-trips/batch", { truckId: t.id, businessDate: today(), trips: [row] });
    const { customerId: _omit, ...noCustomer } = bricks("x");
    expect((await post(noCustomer)).status).toBe(400);
    expect((await post(bricks("not-an-id"))).status).toBe(400);
    expect((await post(bricks("aaaaaaaaaaaaaaaaaaaaaaaa"))).status).toBe(400);
    const c = await mkCustomer();
    await asOwner("delete", `/api/customers/${c.id}`, { reason: "Archived" });
    const archived = await post(bricks(c.id));
    expect(archived.status).toBe(409);
    expect(archived.body.errors[0].message).toMatch(/archived/);
    expect(db.trips.size).toBe(0);
  });

  it("normal customers are UNBILLED, the Internal customer is NOT_BILLABLE, and billable=true never returns internal Pheera", async () => {
    const c = await mkCustomer();
    const internal = await mkInternal();
    const rows = await mkTrips([bricks(c.id, 2000), bricks(internal.id, 500), soil(c.id)]);
    expect(rows.map((r) => r.billingStatus)).toEqual(["UNBILLED", "NOT_BILLABLE", "UNBILLED"]);
    expect(rows[1].customer).toEqual({ id: internal.id, name: "Internal / No Bill" });
    const billable = ok(await asOwner("get", "/api/truck-trips?billable=true"));
    expect(billable.map((r) => r.id).sort()).toEqual([rows[0].id, rows[2].id].sort());
    expect(ok(await asOwner("get", "/api/truck-trips?billingStatus=NOT_BILLABLE")).map((r) => r.id)).toEqual([rows[1].id]);
    expect(ok(await asOwner("get", `/api/truck-trips?customerId=${c.id}`)).length).toBe(2);
    expect((await asOwner("get", "/api/truck-trips?billingStatus=BOGUS")).status).toBe(400);
  });

  it("historical Pheera (no customer) stay editable, are not billable, and are never assigned automatically", async () => {
    const t = await mkTruck();
    const id = new mongoose.Types.ObjectId().toString();
    db.trips.set(id, { _id: id, truckId: t.id, truckNumber: t.truckNumber, businessDate: today(), pheeraNo: 1, materialCategory: "BRICKS", materialName: "Bricks", materialKey: "bricks", destination: "Old", destinationKey: "old", quantity: 100, unit: "bricks", remarks: "", revision: 1, history: [], isDeleted: false, createdAt: new Date(), updatedAt: new Date() });
    const h = await trip(id);
    expect(h).toMatchObject({ billingStatus: null, customer: null, bill: null });
    expect(ok(await asOwner("get", "/api/truck-trips?billable=true")).length).toBe(0);
    expect(ok(await asOwner("patch", `/api/truck-trips/${id}`, { quantity: 150, reason: "Recount" })).quantity).toBe(150);
    expect((await generate([id])).status).toBe(409);
    const c = await mkCustomer();
    const assigned = ok(await asOwner("patch", `/api/truck-trips/${id}/customer`, { customerId: c.id, reason: "Owner confirmed customer" }));
    expect(assigned).toMatchObject({ billingStatus: "UNBILLED", customer: { id: c.id } });
    expect(assigned.billingHistory[0]).toMatchObject({ action: "CUSTOMER_ASSIGNED", reason: "Owner confirmed customer" });
    const internal = await mkInternal();
    expect(ok(await asOwner("patch", `/api/truck-trips/${id}/customer`, { customerId: internal.id, reason: "Was own use" })).billingStatus).toBe("NOT_BILLABLE");
  });
});

describe("archived customer on a new Pheera answers 409 everywhere", () => {
  it("returns 409 for an already archived customer (single and batch), 400 only for an unknown one, and saves nothing", async () => {
    const t = await mkTruck();
    const active = await mkCustomer("Active Buyer");
    const gone = await mkCustomer("Gone Buyer");
    ok(await asOwner("delete", `/api/customers/${gone.id}`, { reason: "Stopped buying" }));
    const when = { truckId: t.id, businessDate: today() };

    const single = await asOwner("post", "/api/truck-trips", { ...when, ...bricks(gone.id) });
    expect(single.status).toBe(409);
    expect(single.body.errors[0]).toMatchObject({ field: "trips.0.customerId", message: expect.stringMatching(/Gone Buyer.*archived/) });

    const mixed = await asOwner("post", "/api/truck-trips/batch", { ...when, trips: [bricks(active.id), bricks(gone.id, 5)] });
    expect(mixed.status).toBe(409);
    expect(mixed.body.errors).toEqual([{ field: "trips.1.customerId", message: expect.stringMatching(/archived/) }]);

    const unknown = await asOwner("post", "/api/truck-trips/batch", { ...when, trips: [bricks("aaaaaaaaaaaaaaaaaaaaaaaa"), bricks(gone.id)] });
    expect(unknown.status).toBe(400); // an unknown customer is still a plain validation error
    expect(unknown.body.errors.map((e) => e.field)).toEqual(["trips.0.customerId", "trips.1.customerId"]);
    expect(db.trips.size).toBe(0);
    expect(ok(await asOwner("post", "/api/truck-trips", { ...when, ...bricks(active.id) }), 201).billingStatus).toBe("UNBILLED"); // other customers unaffected
  });
});

// ---------------------------------------------------------------------------
describe("pricing: bricks per 1,000, everything else per tonne", () => {
  it("per-1,000 bricks amounts are proportional and rounded once", () => {
    expect(lineTaxable(25_000_000, 700_000, "PER_THOUSAND")).toBe(17_500_000); // 25,000 bricks @ 7,000 per 1,000 = 1,75,000.00
    expect(lineTaxable(1_500_000, 700_000, "PER_THOUSAND")).toBe(1_050_000); // 10,500.00
    expect(lineTaxable(1_234_000, 700_000, "PER_THOUSAND")).toBe(863_800); // 8,638.00
    expect(lineTaxable(1000, 700_050, "PER_THOUSAND")).toBe(700); // 1 brick @ 7,000.50 = 7.0005 -> 7.00
    expect(lineTaxable(4500, 120_000, "PER_UNIT")).toBe(540_000); // 4.5 tonnes @ 1,200 = 5,400.00
    expect(lineTaxable(2500, 1000)).toBe(2500); // default is per unit, exactly as every older bill
    expect(pricingUnitFor("BRICKS")).toBe("PER_THOUSAND");
    expect(pricingUnitFor("SOIL")).toBe("PER_UNIT");
    expect(pricingUnitFor("OTHER")).toBe("PER_UNIT");
  });

  it("GST is applied per line on the calculated amount", () => {
    const { lines, totals } = calculateBill({ items: [{ quantityMilli: 25_000_000, ratePaise: 700_000, taxRateBp: 500, pricingUnit: "PER_THOUSAND" }, { quantityMilli: 4500, ratePaise: 120_000, taxRateBp: 500 }], taxMode: "GST", taxType: "INTRA" });
    expect(lines[0]).toMatchObject({ taxablePaise: 17_500_000, cgstPaise: 437_500, sgstPaise: 437_500 });
    expect(lines[1]).toMatchObject({ taxablePaise: 540_000, cgstPaise: 13_500 });
    expect(totals.grandTotalPaise).toBe(17_500_000 + 540_000 + 2 * 437_500 + 2 * 13_500);
  });
});

// ---------------------------------------------------------------------------
describe("draft bill from Pheeras", () => {
  it("makes one line per Pheera with its own quantity and unit, blank rate / HSN / tax, reserves the Pheeras, and defaults to today", async () => {
    await configure();
    const c = await mkCustomer();
    const [b1, s1] = await mkTrips([bricks(c.id, 25000), soil(c.id, 4.5)]);
    const res = await generate([s1.id, b1.id]);
    const d = ok(res, 201);
    expect(d).toMatchObject({ status: "DRAFT", billNumber: null, billDate: today(), customerId: c.id, tripCount: 2, taxMode: "GST", grandTotalPaise: 0 });
    expect(d.customer).toMatchObject({ name: "Shree Constructions", stateCode: "27" });
    expect(d.items).toHaveLength(2);
    const brick = d.items.find((i) => i.sourceTripId === b1.id);
    expect(brick).toMatchObject({ quantity: 25000, unit: "bricks", pricingUnit: "PER_THOUSAND", hsn: "", taxRate: null, ratePaise: 0, source: { pheeraNo: 1, quantity: 25000 } });
    expect(brick.particulars).toMatch(/^Bricks - Truck MH-04-AB-1001 - to Palghar - \d\d-\d\d-\d{4} \(Pheera 1\)$/);
    expect(d.items.find((i) => i.sourceTripId === s1.id)).toMatchObject({ quantity: 4.5, unit: "tonnes", pricingUnit: "PER_UNIT" });
    expect(d.trips.map((t) => t.billingStatus)).toEqual(["RESERVED", "RESERVED"]);
    const t = await trip(b1.id);
    expect(t).toMatchObject({ billingStatus: "RESERVED", billId: d.id, bill: { id: d.id, billNumber: null, status: "DRAFT" } });
    expect(t.billingHistory[0]).toMatchObject({ action: "RESERVED", billId: d.id });
    expect(ok(await asOwner("get", "/api/truck-trips?billable=true")).length).toBe(0);
    expect(ok(await asOwner("get", `/api/bills/${d.id}/trips`)).length).toBe(2);
  });

  it("calculates amounts on the server once the owner fills the rate, HSN and tax rate", async () => {
    await configure();
    const c = await mkCustomer();
    const [b1, s1] = await mkTrips([bricks(c.id, 25000), soil(c.id, 4.5)]);
    const d = ok(await generate([b1.id, s1.id]), 201);
    const filled = ok(await asOwner("patch", `/api/bills/${d.id}`, { items: [{ sourceTripId: b1.id, hsn: "6901", rate: 7000, taxRate: 5 }, { sourceTripId: s1.id, hsn: "2505", rate: 1200, taxRate: 5 }] }));
    expect(filled.items[0]).toMatchObject({ taxablePaise: 17_500_000, ratePaise: 700_000, quantity: 25000 });
    expect(filled.items[1]).toMatchObject({ taxablePaise: 540_000, quantity: 4.5 });
    expect(filled.taxType).toBe("INTRA");
    expect(filled.grandTotalPaise).toBe(18_040_000 + 902_000);
    expect(filled.tripCount).toBe(2);
  });

  it("refuses Internal, historical, already reserved/billed, mixed-customer, missing, voided and duplicate Pheeras (server side)", async () => {
    await configure();
    const c = await mkCustomer();
    const c2 = await mkCustomer("Om Builders");
    const internal = await mkInternal();
    const [a, i, b, v] = await mkTrips([bricks(c.id), bricks(internal.id), bricks(c2.id), bricks(c.id, 300)]);
    const gi = await generate([i.id]);
    expect(gi.status).toBe(409);
    expect(gi.body.errors[0].message).toMatch(/internal/);
    expect((await generate([a.id, i.id])).status).toBe(409);
    const mixed = await generate([a.id, b.id]);
    expect(mixed.status).toBe(409);
    expect(mixed.body.message).toMatch(/different customers/);
    expect((await generate(["aaaaaaaaaaaaaaaaaaaaaaaa"])).status).toBe(404);
    expect((await generate([a.id, a.id])).status).toBe(400);
    ok(await asOwner("post", `/api/truck-trips/${v.id}/void`, { reason: "Wrong entry" }));
    expect((await generate([v.id])).status).toBe(409);
    ok(await generate([a.id]), 201);
    const again = await generate([a.id]);
    expect(again.status).toBe(409);
    expect(again.body.errors[0].message).toMatch(/already in a draft bill/);
    expect(db.bills.size).toBe(1);
    expect(rawTrip(i.id).billingStatus).toBe("NOT_BILLABLE");
    expect(rawTrip(b.id).billingStatus).toBe("UNBILLED");
  });

  it("is owner only, strict, and idempotent by requestId", async () => {
    await configure();
    const c = await mkCustomer();
    const [a, b] = await mkTrips([bricks(c.id), bricks(c.id, 200)]);
    expect((await send("post", "/api/bills/from-trips", manager.cookie, { tripIds: [a.id], requestId: "request-manager-1" })).status).toBe(403);
    for (const body of [{ tripIds: [], requestId: "request-123456" }, { tripIds: [a.id] }, { tripIds: [a.id], requestId: "x" }, { tripIds: [a.id], requestId: "request-123456", customerId: c.id }, { tripIds: ["nope"], requestId: "request-123456" }]) {
      expect((await asOwner("post", "/api/bills/from-trips", body)).status, JSON.stringify(body)).toBe(400);
    }
    const first = await generate([a.id, b.id], "same-request-0001");
    const d = ok(first, 201);
    const second = await generate([b.id, a.id], "same-request-0001");
    expect(ok(second, 200).id).toBe(d.id);
    expect(second.body.meta.duplicate).toBe(true);
    expect(db.bills.size).toBe(1);
    expect((await generate([a.id], "same-request-0001")).status).toBe(409); // same id, different Pheeras
  });

  it("creates nothing when another bill takes a Pheera between the check and the reservation", async () => {
    await configure();
    const c = await mkCustomer();
    const [a, b] = await mkTrips([bricks(c.id), bricks(c.id, 200)]);
    let hit = false;
    db.beforeTripUpdate = (filter) => {
      if (!hit && filter.billingStatus === "UNBILLED") {
        hit = true;
        rawTrip(b.id).billingStatus = "RESERVED"; // a rival draft got there first
        rawTrip(b.id).billId = new mongoose.Types.ObjectId().toString();
      }
    };
    const res = await generate([a.id, b.id]);
    expect(res.status).toBe(409);
    expect(db.bills.size).toBe(0);
    expect(rawTrip(a.id)).toMatchObject({ billingStatus: "UNBILLED", billId: null });
  });

  it("undoes the reservation when the draft cannot be saved", async () => {
    await configure();
    const c = await mkCustomer();
    const [a] = await mkTrips([bricks(c.id)]);
    db.beforeBillUpdate = null;
    const original = db.bills.set.bind(db.bills);
    db.bills.set = () => { throw new Error("simulated database failure"); };
    const res = await generate([a.id]);
    db.bills.set = original;
    expect(res.status).toBe(500);
    expect(db.bills.size).toBe(0);
    expect(rawTrip(a.id)).toMatchObject({ billingStatus: "UNBILLED", billId: null });
  });
});

// ---------------------------------------------------------------------------
describe("locking", () => {
  it("a reserved Pheera cannot be corrected, voided or reassigned; a billed one cannot either", async () => {
    await configure();
    const c = await mkCustomer();
    const c2 = await mkCustomer("Om Builders");
    const [a] = await mkTrips([bricks(c.id, 1000)]);
    const d = ok(await generate([a.id]), 201);
    const attempts = () => [
      asOwner("patch", `/api/truck-trips/${a.id}`, { quantity: 5, reason: "Fix" }),
      asOwner("post", `/api/truck-trips/${a.id}/void`, { reason: "Wrong" }),
      asOwner("delete", `/api/truck-trips/${a.id}`, { reason: "Wrong" }),
      asOwner("patch", `/api/truck-trips/${a.id}/customer`, { customerId: c2.id, reason: "Other" }),
    ];
    for (const p of attempts()) {
      const res = await p;
      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(/draft bill/);
    }
    expect(rawTrip(a.id)).toMatchObject({ quantity: 1000, isDeleted: false, customerId: c.id });
    const f = await fillDraft(d);
    const done = ok(await finalize(f.id));
    for (const p of attempts()) {
      const res = await p;
      expect(res.status).toBe(409);
      expect(res.body.message).toContain(done.billNumber);
    }
    expect((await asOwner("post", `/api/truck-trips/${a.id}/release`, { reason: "Try" })).status).toBe(409); // invoice is not cancelled
    expect(rawTrip(a.id)).toMatchObject({ quantity: 1000, isDeleted: false, billingStatus: "BILLED" });
  });

  it("the locked state is also enforced in the write, not only in the read", async () => {
    const c = await mkCustomer();
    const [a] = await mkTrips([bricks(c.id, 1000)]);
    db.beforeTripUpdate = () => { rawTrip(a.id).billingStatus = "RESERVED"; }; // reserved between the read and the write
    const res = await asOwner("patch", `/api/truck-trips/${a.id}`, { quantity: 5, reason: "Fix" });
    expect(res.status).toBe(409);
    expect(rawTrip(a.id).quantity).toBe(1000);
  });

  it("an internal Pheera can still be corrected and voided", async () => {
    const internal = await mkInternal();
    const [a] = await mkTrips([bricks(internal.id, 1000)]);
    expect(ok(await asOwner("patch", `/api/truck-trips/${a.id}`, { quantity: 900, reason: "Recount" })).quantity).toBe(900);
    expect(ok(await asOwner("post", `/api/truck-trips/${a.id}/void`, { reason: "Wrong entry" })).isVoided).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe("editing, adding and removing Pheera lines on a draft", () => {
  it("lets the owner change rate/HSN/tax but not quantity or unit, and mixes in manual lines", async () => {
    await configure();
    const c = await mkCustomer();
    const [a] = await mkTrips([bricks(c.id, 1000)]);
    const d = ok(await generate([a.id]), 201);
    const bad = await asOwner("patch", `/api/bills/${d.id}`, { items: [{ sourceTripId: a.id, quantity: 999, rate: 5 }] });
    expect(bad.status).toBe(400);
    expect(bad.body.errors[0].field).toBe("items.0.quantity");
    expect((await asOwner("patch", `/api/bills/${d.id}`, { items: [{ sourceTripId: a.id, unit: "tonnes" }] })).status).toBe(400);
    expect((await asOwner("patch", `/api/bills/${d.id}`, { items: [{ sourceTripId: "aaaaaaaaaaaaaaaaaaaaaaaa" }] })).status).toBe(400);
    const u = ok(await asOwner("patch", `/api/bills/${d.id}`, { items: [{ sourceTripId: a.id, quantity: 1000, rate: 7000, hsn: "6901", taxRate: 5 }, { particulars: "Loading charge", hsn: "9967", quantity: 1, unit: "job", rate: 500, taxRate: 5 }] }));
    expect(u.items[0]).toMatchObject({ pricingUnit: "PER_THOUSAND", taxablePaise: 700_000, sourceTripId: a.id });
    expect(u.items[1]).toMatchObject({ pricingUnit: "PER_UNIT", sourceTripId: null, taxablePaise: 50_000 });
    expect(u.tripCount).toBe(1);
  });

  it("removing a Pheera line releases the Pheera", async () => {
    await configure();
    const c = await mkCustomer();
    const [a, b] = await mkTrips([bricks(c.id, 1000), bricks(c.id, 2000)]);
    const d = ok(await generate([a.id, b.id]), 201);
    const u = ok(await asOwner("patch", `/api/bills/${d.id}`, { items: [{ sourceTripId: a.id, rate: 7000 }] }));
    expect(u.items).toHaveLength(1);
    expect(u.sourceTripIds).toEqual([a.id]);
    expect(rawTrip(b.id)).toMatchObject({ billingStatus: "UNBILLED", billId: null });
    expect(rawTrip(b.id).billingHistory.map((h) => h.action)).toEqual(["RESERVED", "RELEASED"]);
    const del = ok(await asOwner("delete", `/api/bills/${d.id}/trips/${a.id}`));
    expect(del.items).toHaveLength(0);
    expect(rawTrip(a.id).billingStatus).toBe("UNBILLED");
    expect((await asOwner("delete", `/api/bills/${d.id}/trips/${a.id}`)).status).toBe(404);
  });

  it("adds Pheeras of the same customer only, and the customer cannot change while Pheera lines exist", async () => {
    await configure();
    const c = await mkCustomer();
    const c2 = await mkCustomer("Om Builders");
    const [a, b, o] = await mkTrips([bricks(c.id, 1000), soil(c.id, 3), bricks(c2.id, 500)]);
    const d = ok(await generate([a.id]), 201);
    const added = ok(await asOwner("post", `/api/bills/${d.id}/trips`, { tripIds: [b.id] }));
    expect(added.items).toHaveLength(2);
    expect(added.trips.map((t) => t.billingStatus)).toEqual(["RESERVED", "RESERVED"]);
    expect((await asOwner("post", `/api/bills/${d.id}/trips`, { tripIds: [o.id] })).status).toBe(409);
    expect((await asOwner("post", `/api/bills/${d.id}/trips`, { tripIds: [b.id] })).status).toBe(409); // already on it
    expect((await asOwner("patch", `/api/bills/${d.id}`, { customerId: c2.id })).status).toBe(409);
    expect((await asOwner("patch", `/api/bills/${d.id}`, { customer: { name: "Someone Else" } })).status).toBe(409);
    expect(ok(await asOwner("patch", `/api/bills/${d.id}`, { customer: { address: "New address, Vapi" } })).customer.address).toBe("New address, Vapi");
    expect(rawTrip(o.id).billingStatus).toBe("UNBILLED");
    expect((await asManager("post", `/api/bills/${d.id}/trips`, { tripIds: [o.id] })).status).toBe(403);
  });

  it("discarding the draft releases every Pheera", async () => {
    await configure();
    const c = await mkCustomer();
    const [a, b] = await mkTrips([bricks(c.id, 1000), bricks(c.id, 2000)]);
    const d = ok(await generate([a.id, b.id]), 201);
    ok(await asOwner("post", `/api/bills/${d.id}/discard`, { reason: "Changed my mind" }));
    for (const id of [a.id, b.id]) expect(rawTrip(id)).toMatchObject({ billingStatus: "UNBILLED", billId: null });
    expect(ok(await asOwner("get", "/api/truck-trips?billable=true")).length).toBe(2);
    const second = ok(await generate([a.id, b.id]), 201); // can be billed again
    expect(second.id).not.toBe(d.id);
  });
});

// ---------------------------------------------------------------------------
describe("finalizing", () => {
  it("blocks a draft with a blank rate, HSN or tax rate, then marks every Pheera BILLED", async () => {
    await configure();
    const c = await mkCustomer();
    const [a] = await mkTrips([bricks(c.id, 25000)]);
    const d = ok(await generate([a.id]), 201);
    const blocked = await finalize(d.id);
    expect(blocked.status).toBe(400);
    expect(blocked.body.errors.map((e) => e.field)).toEqual(expect.arrayContaining(["items.0.rate", "items.0.hsn", "items.0.taxRate"]));
    expect(rawTrip(a.id).billingStatus).toBe("RESERVED");
    await fillDraft(d, { rate: 7000 });
    const done = ok(await finalize(d.id));
    expect(done).toMatchObject({ status: "FINALIZED", grandTotalPaise: 17_500_000 + 875_000 });
    expect(done.billNumber).toMatch(/^AC\//);
    expect(rawTrip(a.id)).toMatchObject({ billingStatus: "BILLED", billId: d.id });
    expect(rawTrip(a.id).billingHistory.map((h) => h.action)).toEqual(["RESERVED", "BILLED"]);
    expect(rawTrip(a.id).billingHistory[1].billNumber).toBe(done.billNumber);
  });

  it("does not finalize, and does not use up an invoice number, if a Pheera is no longer reserved for the draft", async () => {
    await configure();
    const c = await mkCustomer();
    const [a, b] = await mkTrips([bricks(c.id, 1000), bricks(c.id, 2000)]);
    const d = ok(await generate([a.id, b.id]), 201);
    await fillDraft(d);
    const counters = JSON.stringify(db.counters);
    rawTrip(b.id).billingStatus = "UNBILLED"; // changed behind the draft's back
    rawTrip(b.id).billId = null;
    const res = await finalize(d.id);
    expect(res.status).toBe(409);
    expect((await bill(d.id)).status).toBe("DRAFT");
    expect(rawTrip(a.id).billingStatus).toBe("RESERVED");
    expect(JSON.stringify(db.counters)).toBe(counters);
  });
});

// ---------------------------------------------------------------------------
describe("cancelling, releasing and re-billing", () => {
  const billed = async (quantities = [1000, 2000]) => {
    await configure();
    const c = await mkCustomer();
    const rows = await mkTrips(quantities.map((q) => bricks(c.id, q)));
    const d = ok(await generate(rows.map((r) => r.id)), 201);
    await fillDraft(d);
    const inv = ok(await finalize(d.id));
    return { c, rows, inv };
  };

  it("cancelling an invoice keeps its Pheeras BILLED and records it", async () => {
    const { rows, inv } = await billed();
    ok(await asOwner("post", `/api/bills/${inv.id}/cancel`, { reason: "Wrong rate" }));
    for (const r of rows) {
      expect(rawTrip(r.id).billingStatus).toBe("BILLED");
      expect(rawTrip(r.id).billingHistory.map((h) => h.action)).toEqual(["RESERVED", "BILLED", "BILL_CANCELLED"]);
    }
    expect(ok(await asOwner("get", "/api/truck-trips?billable=true")).length).toBe(0);
    expect(await trip(rows[0].id)).toMatchObject({ bill: { billNumber: inv.billNumber, status: "CANCELLED" } });
  });

  it("method B: releases a Pheera of a cancelled invoice to UNBILLED with a mandatory reason, keeping the invoice reference", async () => {
    const { rows, inv, c } = await billed();
    expect((await asOwner("post", `/api/truck-trips/${rows[0].id}/release`, { reason: "Wrong rate" })).status).toBe(409); // still a live invoice
    ok(await asOwner("post", `/api/bills/${inv.id}/cancel`, { reason: "Wrong rate" }));
    expect((await asOwner("post", `/api/truck-trips/${rows[0].id}/release`, {})).status).toBe(400);
    expect((await asOwner("post", `/api/truck-trips/${rows[0].id}/release`, { reason: "ab" })).status).toBe(400);
    expect((await asManager("post", `/api/truck-trips/${rows[0].id}/release`, { reason: "Wrong rate" })).status).toBe(403);
    const released = ok(await asOwner("post", `/api/truck-trips/${rows[0].id}/release`, { reason: "Re-bill at the right rate" }));
    expect(released).toMatchObject({ billingStatus: "UNBILLED", billId: null, bill: null });
    const last = released.billingHistory.at(-1);
    expect(last).toMatchObject({ action: "RELEASED", billId: inv.id, billNumber: inv.billNumber, reason: "Re-bill at the right rate" });
    expect(rawTrip(rows[1].id).billingStatus).toBe("BILLED"); // the other one is untouched
    const fresh = ok(await generate([rows[0].id]), 201); // and can be billed again
    expect(fresh.customerId).toBe(c.id);
    expect((await asOwner("post", `/api/truck-trips/${rows[0].id}/release`, { reason: "Again" })).status).toBe(409); // now reserved
  });

  it("method A: the correction draft moves the Pheeras atomically and keeps the cancelled invoice reference", async () => {
    const { rows, inv } = await billed();
    ok(await asOwner("post", `/api/bills/${inv.id}/cancel`, { reason: "Wrong rate" }));
    const copy = ok(await asOwner("post", `/api/bills/${inv.id}/correct`, {}), 201);
    expect(copy).toMatchObject({ status: "DRAFT", billNumber: null, replacesBillNumber: inv.billNumber, customerId: inv.customerId, tripCount: 2, skippedTrips: [] });
    expect(copy.items.map((i) => i.sourceTripId).sort()).toEqual(rows.map((r) => r.id).sort());
    expect(copy.items[0]).toMatchObject({ pricingUnit: "PER_THOUSAND", ratePaise: 700_000 });
    for (const r of rows) {
      expect(rawTrip(r.id)).toMatchObject({ billingStatus: "RESERVED", billId: copy.id });
      const last = rawTrip(r.id).billingHistory.at(-1);
      expect(last).toMatchObject({ action: "REBILLED", billId: copy.id, previousBillId: inv.id, previousBillNumber: inv.billNumber });
    }
    const done = ok(await finalize(copy.id));
    expect(done.billNumber).not.toBe(inv.billNumber);
    for (const r of rows) expect(rawTrip(r.id)).toMatchObject({ billingStatus: "BILLED", billId: copy.id });
    expect((await bill(inv.id)).status).toBe("CANCELLED"); // the cancelled invoice is untouched
    expect((await bill(inv.id)).sourceTripIds.length).toBe(2);
  });

  it("method A leaves out a Pheera that was already released, and never puts a Pheera on two invoices", async () => {
    const { rows, inv } = await billed();
    ok(await asOwner("post", `/api/bills/${inv.id}/cancel`, { reason: "Wrong rate" }));
    ok(await asOwner("post", `/api/truck-trips/${rows[1].id}/release`, { reason: "Billing it separately" }));
    const copy = ok(await asOwner("post", `/api/bills/${inv.id}/correct`, {}), 201);
    expect(copy.tripCount).toBe(1);
    expect(copy.skippedTrips).toEqual([{ tripId: rows[1].id, reason: expect.stringMatching(/No longer billed/) }]);
    expect(rawTrip(rows[1].id).billingStatus).toBe("UNBILLED");
    const second = await asOwner("post", `/api/bills/${inv.id}/correct`, {}); // nothing left to move
    expect(second.status).toBe(409);
    expect(db.bills.size).toBe(2);
  });

  it("method A changes nothing when a Pheera changes during the move", async () => {
    const { rows, inv } = await billed();
    ok(await asOwner("post", `/api/bills/${inv.id}/cancel`, { reason: "Wrong rate" }));
    let hit = false;
    db.beforeTripUpdate = (filter) => {
      if (!hit && filter.billingStatus === "BILLED") {
        hit = true;
        rawTrip(rows[1].id).billId = new mongoose.Types.ObjectId().toString();
      }
    };
    const res = await asOwner("post", `/api/bills/${inv.id}/correct`, {});
    expect(res.status).toBe(409);
    expect(db.bills.size).toBe(1);
    expect(rawTrip(rows[0].id)).toMatchObject({ billingStatus: "BILLED", billId: inv.id });
  });

  it("a manual bill is corrected exactly as before", async () => {
    await configure();
    const manual = ok(await asOwner("post", "/api/bills", { customer: { name: "Walk-in", address: "Vapi", stateCode: "27" }, taxMode: "GST", items: [{ particulars: "Bricks", hsn: "6901", quantity: 1000, unit: "bricks", rate: 8.5, taxRate: 5 }] }), 201);
    expect(manual).toMatchObject({ customerId: null, tripCount: 0, sourceTripIds: [] });
    const inv = ok(await finalize(manual.id));
    ok(await asOwner("post", `/api/bills/${inv.id}/cancel`, { reason: "Wrong" }));
    const copy = ok(await asOwner("post", `/api/bills/${inv.id}/correct`, {}), 201);
    expect(copy).toMatchObject({ replacesBillNumber: inv.billNumber, itemCount: 1 });
    expect(copy.items[0]).toMatchObject({ pricingUnit: "PER_UNIT", sourceTripId: null, ratePaise: 850 });
  });
});

// ---------------------------------------------------------------------------
describe("customers on bills", () => {
  it("a manual bill may pick a saved customer (snapshot copied) or none at all", async () => {
    const c = await mkCustomer("Shree Constructions", { gstin: GSTIN_27 });
    const d = ok(await asOwner("post", "/api/bills", { customerId: c.id, items: [] }), 201);
    expect(d).toMatchObject({ customerId: c.id, customer: { name: "Shree Constructions", gstin: GSTIN_27, address: "Plot 12, Vapi" } });
    const archived = await mkCustomer("Gone Ltd");
    await asOwner("delete", `/api/customers/${archived.id}`, { reason: "Archived" });
    expect((await asOwner("post", "/api/bills", { customerId: archived.id })).status).toBe(409);
    expect((await asOwner("post", "/api/bills", { customerId: "aaaaaaaaaaaaaaaaaaaaaaaa" })).status).toBe(404);
  });

  it("the Internal customer can never be an invoice customer, by id or by name", async () => {
    const internal = await mkInternal();
    const byId = await asOwner("post", "/api/bills", { customerId: internal.id });
    expect(byId.status).toBe(409);
    expect(byId.body.message).toMatch(/cannot be used as an invoice customer/);
    const byName = await asOwner("post", "/api/bills", { customer: { name: "Internal / No Bill" } });
    expect(byName.status).toBe(400);
    const d = ok(await asOwner("post", "/api/bills", { customer: { name: "Someone" } }), 201);
    expect((await asOwner("patch", `/api/bills/${d.id}`, { customerId: internal.id })).status).toBe(409);
    expect((await asOwner("patch", `/api/bills/${d.id}`, { customer: { name: "internal / no bill" } })).status).toBe(400);
    expect(db.bills.size).toBe(1);
  });

  it("a draft with no saved customer cannot take Pheeras", async () => {
    const c = await mkCustomer();
    const [a] = await mkTrips([bricks(c.id)]);
    const d = ok(await asOwner("post", "/api/bills", { customer: { name: "Typed by hand" } }), 201);
    const res = await asOwner("post", `/api/bills/${d.id}/trips`, { tripIds: [a.id] });
    expect(res.status).toBe(409);
    expect(rawTrip(a.id).billingStatus).toBe("UNBILLED");
  });

  it("a client cannot send Pheera links, billing status or pricing unit on a new bill", async () => {
    for (const body of [{ items: [{ particulars: "x", pricingUnit: "PER_THOUSAND" }] }, { sourceTripIds: ["aaaaaaaaaaaaaaaaaaaaaaaa"] }, { requestId: "request-123456" }, { items: [{ particulars: "x", sourceTripId: "aaaaaaaaaaaaaaaaaaaaaaaa" }] }]) {
      expect((await asOwner("post", "/api/bills", body)).status, JSON.stringify(body)).toBe(400);
    }
  });
});

// ---------------------------------------------------------------------------
describe("nothing else is touched", () => {
  it("leaves labour, attendance, payments and trucks unchanged through the whole workflow", async () => {
    await configure();
    const before = snapshotOthers();
    const c = await mkCustomer();
    const [a] = await mkTrips([bricks(c.id)], await mkTruck());
    const mid = snapshotOthers();
    const d = ok(await generate([a.id]), 201);
    await fillDraft(d);
    ok(await finalize(d.id));
    expect(mid).toBe(snapshotOthers());
    expect(before.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// A rival request that commits just before our write is simulated by a hook that runs at that exact point.
const archiveBehindBack = (customerId) => {
  const row = db.customers.get(customerId);
  Object.assign(row, { isDeleted: true, deletedAt: new Date(), deletedBy: "Rival", deletedReason: "Archived elsewhere", revision: row.revision + 1 });
};
const onceOn = (test, fn) => {
  let done = false;
  return (filter) => {
    if (!done && test(filter)) {
      done = true;
      fn(filter);
    }
  };
};
const isGuard = (f) => f.isDeleted === false && f.revision === undefined; // the "customer still active?" write
const isArchive = (f) => f.isDeleted === false && f.revision !== undefined; // the archive write itself

describe("customer archival vs concurrent Pheera operations", () => {
  it("archiving is allowed with ordinary UNBILLED and BILLED Pheeras, and changes neither them nor the invoice", async () => {
    await configure();
    const c = await mkCustomer();
    const [a, b] = await mkTrips([bricks(c.id, 1000), bricks(c.id, 2000)]);
    const d = ok(await generate([a.id]), 201);
    await fillDraft(d);
    const inv = ok(await finalize(d.id));
    const res = ok(await asOwner("delete", `/api/customers/${c.id}`, { reason: "Stopped buying" }));
    expect(res.isArchived).toBe(true);
    expect(rawTrip(a.id)).toMatchObject({ billingStatus: "BILLED", billId: d.id });
    expect(rawTrip(b.id).billingStatus).toBe("UNBILLED");
    expect(await bill(inv.id)).toMatchObject({ status: "FINALIZED", billNumber: inv.billNumber, customer: { name: "Shree Constructions" } });
  });

  it("archiving is refused while a Pheera is reserved in a draft, and works after the draft is discarded", async () => {
    await configure();
    const c = await mkCustomer();
    const [a] = await mkTrips([bricks(c.id)]);
    const d = ok(await generate([a.id]), 201);
    const res = await asOwner("delete", `/api/customers/${c.id}`, { reason: "Stopped buying" });
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/draft bill/);
    expect(db.customers.get(c.id)).toMatchObject({ isDeleted: false, revision: 1 });
    ok(await asOwner("post", `/api/bills/${d.id}/discard`, { reason: "Not needed" }));
    expect(ok(await asOwner("delete", `/api/customers/${c.id}`, { reason: "Stopped buying" })).isArchived).toBe(true);
  });

  it("race: a draft takes a Pheera at the very moment of archiving - the archive fails and the customer stays active", async () => {
    await configure();
    const c = await mkCustomer();
    const [a] = await mkTrips([bricks(c.id)]);
    db.beforeCustomerUpdate = onceOn(isArchive, () => {
      Object.assign(rawTrip(a.id), { billingStatus: "RESERVED", billId: new mongoose.Types.ObjectId().toString() }); // a rival draft committed first
    });
    const res = await asOwner("delete", `/api/customers/${c.id}`, { reason: "Stopped buying" });
    expect(res.status).toBe(409);
    expect(db.customers.get(c.id)).toMatchObject({ isDeleted: false, revision: 1 });
    expect(db.customers.get(c.id).history.map((h) => h.action)).toEqual(["CREATE"]);
  });

  it("race: the customer is archived between the check and the write of a new Pheera - nothing is created", async () => {
    const c = await mkCustomer();
    const t = await mkTruck();
    db.beforeCustomerUpdate = onceOn(isGuard, () => archiveBehindBack(c.id));
    const res = await asOwner("post", "/api/truck-trips/batch", { truckId: t.id, businessDate: today(), trips: [bricks(c.id), bricks(c.id, 5)] });
    expect(res.status).toBe(409);
    expect(res.body.errors[0].message).toMatch(/archived/);
    expect(db.trips.size).toBe(0);
  });

  it("race: the customer is archived while a draft is being generated - no draft, no reservation", async () => {
    await configure();
    const c = await mkCustomer();
    const [a, b] = await mkTrips([bricks(c.id), bricks(c.id, 5)]);
    db.beforeCustomerUpdate = onceOn(isGuard, () => archiveBehindBack(c.id));
    const res = await generate([a.id, b.id]);
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/archived/);
    expect(db.bills.size).toBe(0);
    for (const id of [a.id, b.id]) expect(rawTrip(id)).toMatchObject({ billingStatus: "UNBILLED", billId: null });
  });

  it("race: the customer is archived while Pheeras are being added to a draft", async () => {
    await configure();
    const c = await mkCustomer();
    const [a, b] = await mkTrips([bricks(c.id), bricks(c.id, 5)]);
    const d = ok(await generate([a.id]), 201);
    db.beforeCustomerUpdate = onceOn(isGuard, () => archiveBehindBack(c.id));
    expect((await asOwner("post", `/api/bills/${d.id}/trips`, { tripIds: [b.id] })).status).toBe(409);
    expect(rawTrip(b.id).billingStatus).toBe("UNBILLED");
    expect((await bill(d.id)).items).toHaveLength(1);
  });

  it("race: the customer is archived while a Pheera is being assigned to it", async () => {
    const c = await mkCustomer();
    const id = new mongoose.Types.ObjectId().toString();
    const t = await mkTruck();
    db.trips.set(id, { _id: id, truckId: t.id, truckNumber: t.truckNumber, businessDate: today(), pheeraNo: 1, materialCategory: "BRICKS", materialName: "Bricks", materialKey: "bricks", destination: "Old", destinationKey: "old", quantity: 100, unit: "bricks", remarks: "", revision: 1, history: [], isDeleted: false, createdAt: new Date(), updatedAt: new Date() });
    db.beforeCustomerUpdate = onceOn(isGuard, () => archiveBehindBack(c.id));
    expect((await asOwner("patch", `/api/truck-trips/${id}/customer`, { customerId: c.id, reason: "Owner confirmed" })).status).toBe(409);
    expect(rawTrip(id).customerId ?? null).toBeNull();
  });

  it("a cancelled invoice of an archived customer cannot be re-billed until the customer is restored (no new reservation)", async () => {
    await configure();
    const c = await mkCustomer();
    const [a] = await mkTrips([bricks(c.id)]);
    const d = ok(await generate([a.id]), 201);
    await fillDraft(d);
    const inv = ok(await finalize(d.id));
    ok(await asOwner("post", `/api/bills/${inv.id}/cancel`, { reason: "Wrong rate" }));
    ok(await asOwner("delete", `/api/customers/${c.id}`, { reason: "Stopped buying" })); // allowed: only a BILLED Pheera
    const res = await asOwner("post", `/api/bills/${inv.id}/correct`, {});
    expect(res.status).toBe(409);
    expect(db.bills.size).toBe(1);
    expect(rawTrip(a.id)).toMatchObject({ billingStatus: "BILLED", billId: inv.id });
    ok(await asOwner("post", `/api/customers/${c.id}/restore`, {}));
    expect(ok(await asOwner("post", `/api/bills/${inv.id}/correct`, {}), 201).tripCount).toBe(1);
  });

  it("an archived customer still gets no Pheera or draft in the plain (non-race) case", async () => {
    await configure();
    const c = await mkCustomer();
    const [a] = await mkTrips([bricks(c.id)]);
    ok(await asOwner("delete", `/api/customers/${c.id}`, { reason: "Stopped buying" }));
    expect((await generate([a.id])).status).toBe(409);
    const t = await mkTruck();
    expect((await asOwner("post", "/api/truck-trips/batch", { truckId: t.id, businessDate: today(), trips: [bricks(c.id)] })).status).toBe(409);
  });
});

// ---------------------------------------------------------------------------
describe("a bill linked to a saved customer keeps the exact saved name", () => {
  const linkedDraft = async () => {
    const c = await mkCustomer("Shree Constructions", { gstin: GSTIN_27 });
    const d = ok(await asOwner("post", "/api/bills", { customerId: c.id, items: [] }), 201);
    return { c, d };
  };

  it("rejects a different spelling, case or spacing on update, and keeps the saved name", async () => {
    const { d } = await linkedDraft();
    for (const name of ["shree constructions", "SHREE CONSTRUCTIONS", "Shree  Constructions", "Shree Constructions Pvt", "Someone Else"]) {
      const res = await asOwner("patch", `/api/bills/${d.id}`, { customer: { name } });
      expect(res.status, name).toBe(409);
      expect(res.body.errors[0].field).toBe("customer.name");
    }
    expect((await bill(d.id)).customer.name).toBe("Shree Constructions");
  });

  it("accepts the exact name and still lets the owner edit address, GSTIN, state, state code and contact", async () => {
    const { d } = await linkedDraft();
    const u = ok(await asOwner("patch", `/api/bills/${d.id}`, { customer: { name: "Shree Constructions", address: "New address, Vapi", gstin: GSTIN_27, stateName: "Maharashtra", stateCode: "27", contact: "9800000002" } }));
    expect(u.customer).toMatchObject({ name: "Shree Constructions", address: "New address, Vapi", contact: "9800000002", stateCode: "27" });
    expect(ok(await asOwner("patch", `/api/bills/${d.id}`, { customer: { address: "Another address" } })).customer.name).toBe("Shree Constructions");
  });

  it("rejects a mismatching name when creating a linked bill or switching the saved customer", async () => {
    const { c, d } = await linkedDraft();
    expect((await asOwner("post", "/api/bills", { customerId: c.id, customer: { name: "shree constructions" } })).status).toBe(409);
    expect(ok(await asOwner("post", "/api/bills", { customerId: c.id, customer: { name: "Shree Constructions" } }), 201).customer.name).toBe("Shree Constructions");
    const c2 = await mkCustomer("Om Builders");
    expect((await asOwner("patch", `/api/bills/${d.id}`, { customerId: c2.id, customer: { name: "Shree Constructions" } })).status).toBe(409);
    expect((await asOwner("patch", `/api/bills/${d.id}`, { customerId: c2.id, customer: { name: "om builders" } })).status).toBe(409);
    expect((await bill(d.id)).customer.name).toBe("Shree Constructions");
    const switched = ok(await asOwner("patch", `/api/bills/${d.id}`, { customerId: c2.id, customer: { name: "Om Builders" } }));
    expect(switched).toMatchObject({ customerId: c2.id, customer: { name: "Om Builders" } });
  });

  it("does not change standalone manual bills, and a finalized invoice keeps its snapshot when the customer is renamed", async () => {
    await configure();
    const manual = ok(await asOwner("post", "/api/bills", { customer: { name: "Walk-in Buyer", address: "Vapi", stateCode: "27" } }), 201);
    expect(ok(await asOwner("patch", `/api/bills/${manual.id}`, { customer: { name: "walk-in  BUYER Ltd" } })).customer.name).toBe("walk-in  BUYER Ltd"); // a manual bill may still be renamed freely
    const c = await mkCustomer("Shree Constructions", { gstin: GSTIN_27 });
    const d = ok(await asOwner("post", "/api/bills", { customerId: c.id, items: [{ particulars: "Bricks", hsn: "6901", quantity: 1000, unit: "bricks", rate: 8.5, taxRate: 5 }] }), 201);
    const inv = ok(await finalize(d.id));
    ok(await asOwner("patch", `/api/customers/${c.id}`, { name: "Shree Constructions Pvt Ltd" }));
    expect(await bill(inv.id)).toMatchObject({ status: "FINALIZED", customer: { name: "Shree Constructions" } });
  });
});
