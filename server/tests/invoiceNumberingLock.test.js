
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
const { db, makeAttendanceModel, makeCounterModel, makeLabourModel, makeMaapEntryModel, makePaymentModel, makeProductionEntryModel, makeRateModel, makeSeasonModel, makeTruckHistoryModel, makeTruckModel, makeTruckTripModel, makeBillModel, makeInvoiceSettingsModel } = await import("./helpers/memoryDb.js");
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
vi.mock("../models/Bill.js", async (importOriginal) => ({ default: makeBillModel((await importOriginal()).default) }));
vi.mock("../models/InvoiceSettings.js", async (importOriginal) => ({ default: makeInvoiceSettingsModel((await importOriginal()).default) }));
vi.mock("../utils/transaction.js", () => ({ runInTransaction: (work, options) => { (globalThis.__txCalls ??= []).push(options); return db.transaction(() => work(null)); } }));


const { createApp } = await import("../app.js");
const { signAccessToken } = await import("../services/auth.service.js");
const { amountInWords } = await import("../utils/amountInWords.js");
const { calculateBill, deriveTaxType, lineTaxable, taxByRate } = await import("../services/billCalculations.js");
const { parseBp, parseMilli, parseRupeesToPaise, financialYearOf, formatBillNumber } = await import("../utils/billRules.js");
const { renderInvoicePdf, formatMoney, formatQuantity } = await import("../services/billPdf.service.js");
const { addDays, todayBusinessDate } = await import("../utils/dates.js");
const RealBill = (await vi.importActual("../models/Bill.js")).default;
const RealSettings = (await vi.importActual("../models/InvoiceSettings.js")).default;

const ORIGIN = "http://localhost:5173";
const today = () => todayBusinessDate();
const FY = () => financialYearOf(today());
const GSTIN_27 = "27ABCDE1234F1Z5"; // placeholder in the right shape; state code 27
const GSTIN_24 = "24ABCDE1234F1Z5";

const addUser = (role = "OWNER", name = "Ramesh Patel") => {
  const user = { _id: new mongoose.Types.ObjectId().toString(), name, email: `${role.toLowerCase()}@example.com`, role, isActive: true, tokenVersion: 0 };
  users.list.push(user);
  return { user, cookie: `brickpro_token=${signAccessToken(user)}` };
};
let app, owner, manager;
const send = (method, url, cookie, body) => {
  const req = request(app)[method](url).set("Origin", ORIGIN);
  if (cookie) req.set("Cookie", cookie);
  return body === undefined ? req : req.send(body);
};
const asOwner = (method, url, body) => send(method, url, owner.cookie, body);
const asManager = (method, url, body) => send(method, url, manager.cookie, body);

const sellerSettings = { businessName: "AAYUSH CARTING", businessDescription: "BUILDING MATERIAL SUPPLIER", productsLine: "BRICKS, SAND, STONE", address: "Sample Road, Sample Town", phones: ["9800000001"], jurisdiction: "Sample", stateName: "Sample State", stateCode: "27", gstin: GSTIN_27, pan: "ABCDE1234F", bank: { bankName: "Sample Bank", branch: "Main", accountNumber: "1234567890", ifsc: "SAMP0000001" }, proprietorName: "Ramesh Patel" };
const configure = async (extra = {}) => {
  const res = await asOwner("patch", "/api/invoice-settings", { ...sellerSettings, ...extra });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.data;
};
const item = (o = {}) => ({ particulars: "Bricks", hsn: "6901", quantity: 1000, unit: "bricks", rate: 8.5, taxRate: 5, ...o });
const customer = (o = {}) => ({ name: "Shree Constructions", address: "Plot 12, Vapi", stateName: "Maharashtra", stateCode: "27", ...o });
const full = (o = {}) => ({ billDate: today(), customer: customer(), taxMode: "GST", items: [item()], ...o });
const draft = async (o = {}) => {
  const res = await asOwner("post", "/api/bills", full(o));
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.data;
};
const finalize = (id, body = { reviewed: true }) => asOwner("post", `/api/bills/${id}/finalize`, body);
const issued = async (o = {}) => {
  const d = await draft(o);
  const res = await finalize(d.id);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.data;
};
const get = async (id) => (await asOwner("get", `/api/bills/${id}`)).body.data;
const list = async (q = "") => (await asOwner("get", `/api/bills${q}`)).body;
const pdfText = (buffer) => [...buffer.toString("latin1").matchAll(/<([0-9a-f]+)>/gi)].map((m) => Buffer.from(m[1], "hex").toString("latin1")).join("");
const pageCount = (buffer) => (buffer.toString("latin1").match(/\/Type \/Page\b/g) ?? []).length;
const otherModulesSnapshot = () => JSON.stringify([[...db.labours.values()], db.rates, [...db.attendance.values()], [...db.maap.values()], [...db.production.values()], [...db.payments.values()], [...db.seasons.values()], [...db.trucks.values()], [...db.trips.values()]]);

beforeEach(() => {
  db.reset();
  users.list.length = 0;
  owner = addUser("OWNER");
  manager = addUser("MANAGER", "Helper");
  app = createApp();
});
afterEach(() => vi.useRealTimers());

// Phase 1C / P3. FAKE-DATABASE tests only: the in-memory store has no snapshot isolation and no WriteConflict. A rival commit is simulated by
// the db.beforeSettingsUpdate hook (it runs between the service's read and its write). Real MongoDB behaviour is NOT proven here.
const settingsRow = () => db.invoiceSettings.get("default");
const settingsSnap = () => JSON.stringify([...db.invoiceSettings.values()]);
const getSettings = async () => (await asOwner("get", "/api/invoice-settings")).body.data;
const patchSettings = (body) => asOwner("patch", "/api/invoice-settings", body);
const NUMBERING_CHANGES = [
  ["prefix", { prefix: "XY" }],
  ["separator", { separator: "-" }],
  ["includeFinancialYear", { includeFinancialYear: false }],
  ["padding", { padding: 6 }],
];
const finalizedLegacyBill = (status = "FINALIZED") => db.bills.set("legacy", { _id: "legacy", status, billNumber: "AC/2025-26/0001", isDeleted: false, revision: 2 });
beforeEach(() => {
  globalThis.__txCalls = [];
});

describe("P3: before the first finalized or cancelled bill, all four numbering settings are editable", () => {
  it.each(NUMBERING_CHANGES)("%s can be changed on a fresh database and again later", async (field, change) => {
    await configure();
    expect((await getSettings()).numbering.locked).toBe(false);
    expect((await patchSettings({ numbering: change })).status).toBe(200);
    expect((await getSettings()).numbering).toMatchObject({ ...change, locked: false });
  });

  it("a draft does not lock numbering", async () => {
    await configure();
    await draft();
    expect((await patchSettings({ numbering: { prefix: "DR" } })).status).toBe(200);
    expect((await getSettings()).numbering.locked).toBe(false);
  });

  it("a discarded draft does not lock numbering", async () => {
    await configure();
    const d = await draft();
    expect((await asOwner("post", `/api/bills/${d.id}/discard`, { reason: "Duplicate" })).status).toBe(200);
    expect((await patchSettings({ numbering: { padding: 5 } })).status).toBe(200);
    expect((await getSettings()).numbering.locked).toBe(false);
  });

  it("a finalize that fails (not ready) does not lock numbering and uses no number", async () => {
    const d = await draft(); // no seller details configured: the bill is not ready to finalize
    expect((await finalize(d.id)).status).toBe(400);
    expect(settingsRow()?.numberingLocked).not.toBe(true);
    expect(db.counters).toEqual({});
    expect((await patchSettings({ numbering: { prefix: "OK" } })).status).toBe(200);
  });
});

describe("P3: the first finalize locks numbering permanently", () => {
  it("sets the lock inside the finalize, and numbering changes are then refused with 409, one error per changed field", async () => {
    await configure();
    const bill = await issued();
    expect(settingsRow().numberingLocked).toBe(true);
    expect((await getSettings()).numbering.locked).toBe(true);
    for (const [field, change] of NUMBERING_CHANGES) {
      const before = settingsSnap();
      const res = await patchSettings({ numbering: change });
      expect(res.status, field).toBe(409);
      expect(res.body.errors?.map((e) => e.field)).toEqual([`numbering.${field}`]);
      expect(settingsSnap()).toBe(before); // nothing written, revision included
    }
    expect((await get(bill.id)).billNumber).toBe(`AC/${FY()}/0001`);
  });

  it("is a required transaction (a database without transactions answers 503 and writes nothing)", async () => {
    await configure();
    globalThis.__txCalls = [];
    await patchSettings({ numbering: { prefix: "TX" } });
    expect(globalThis.__txCalls.at(-1)).toMatchObject({ required: true });
  });

  it("the lock stays after the bill is cancelled", async () => {
    await configure();
    const bill = await issued();
    expect((await asOwner("post", `/api/bills/${bill.id}/cancel`, { reason: "Wrong party" })).status).toBe(200);
    expect(settingsRow().numberingLocked).toBe(true);
    expect((await patchSettings({ numbering: { prefix: "NEW" } })).status).toBe(409);
  });

  it("a second finalize does not write the settings again", async () => {
    await configure();
    await issued();
    const before = settingsSnap();
    await issued();
    expect(settingsSnap()).toBe(before);
  });

  it("an identical numbering sent again (what the Settings form does) is accepted", async () => {
    await configure();
    await issued();
    expect((await patchSettings({ numbering: { prefix: "AC", separator: "/", includeFinancialYear: true, padding: 4 } })).status).toBe(200);
  });

  it("non-numbering settings stay editable after the lock, and the numbering is untouched", async () => {
    await configure();
    await issued();
    expect((await patchSettings({ businessName: "AAYUSH CARTING AND CO", address: "New Address", bank: { accountNumber: "999999" }, allowedTaxRates: [5, 18] })).status).toBe(200);
    expect(settingsRow()).toMatchObject({ businessName: "AAYUSH CARTING AND CO", numberingLocked: true });
    expect((await getSettings()).numbering).toMatchObject({ prefix: "AC", padding: 4, locked: true });
  });

  it("a request mixing a changed numbering field with other fields is refused whole: nothing is saved", async () => {
    await configure();
    await issued();
    const before = settingsSnap();
    const res = await patchSettings({ businessName: "SOMEONE ELSE", numbering: { prefix: "ZZ" } });
    expect(res.status).toBe(409);
    expect(settingsSnap()).toBe(before);
  });

  it("an identical-numbering request never rewrites the numbering block (a stale copy cannot revert a newer value)", async () => {
    await configure();
    const before = { prefix: "AC", separator: "/", includeFinancialYear: true, padding: 4 };
    db.beforeSettingsUpdate = (_f, update) => {
      expect(update.$set.numbering).toBeUndefined();
    };
    expect((await patchSettings({ businessName: "AAYUSH CARTING NEW", numbering: { ...before } })).status).toBe(200);
    db.beforeSettingsUpdate = null;
  });
});

describe("P3: bills finalized or cancelled BEFORE the lock existed (no flag in the settings document)", () => {
  it.each(["FINALIZED", "CANCELLED"])("an existing %s bill keeps numbering locked, with no data change", async (status) => {
    await configure();
    finalizedLegacyBill(status);
    expect(settingsRow().numberingLocked).not.toBe(true);
    expect((await getSettings()).numbering.locked).toBe(true);
    const before = settingsSnap();
    expect((await patchSettings({ numbering: { prefix: "OLD" } })).status).toBe(409);
    expect(settingsSnap()).toBe(before);
  });
  it("the flag alone locks, even if no bill can be found (the flag is the permanent record)", async () => {
    await configure();
    Object.assign(settingsRow(), { numberingLocked: true });
    expect(db.bills.size).toBe(0);
    expect((await getSettings()).numbering.locked).toBe(true);
    expect((await patchSettings({ numbering: { padding: 7 } })).status).toBe(409);
  });
  it("a legacy DRAFT or discarded bill does not lock", async () => {
    await configure();
    db.bills.set("d1", { _id: "d1", status: "DRAFT", billNumber: null, isDeleted: false });
    db.bills.set("d2", { _id: "d2", status: "DRAFT", billNumber: null, isDeleted: true });
    expect((await patchSettings({ numbering: { prefix: "OK" } })).status).toBe(200);
  });
});

describe("P3: atomic coordination between numbering changes and the first finalize", () => {
  it("a rival FINALIZE commits after the numbering change read the settings: 409 and numbering unchanged", async () => {
    await configure();
    const d = await draft();
    const numberingBefore = { ...settingsRow().numbering };
    db.beforeSettingsUpdate = () => {
      db.beforeSettingsUpdate = null;
      Object.assign(settingsRow(), { numberingLocked: true }); // the rival's finalize wrote the lock (it does not bump the revision)
      db.bills.set(d.id, { ...db.bills.get(d.id), status: "FINALIZED", billNumber: "AC/RIVAL/0001" });
    };
    const res = await patchSettings({ numbering: { prefix: "LATE" } });
    expect(res.status).toBe(409);
    expect(settingsRow().numbering).toMatchObject(numberingBefore);
  });

  it("a rival NUMBERING CHANGE commits after the finalize read the settings: finalize answers 409, no number is used, nothing is half-done", async () => {
    await configure();
    const d = await draft();
    const counters = JSON.stringify(db.counters);
    db.beforeSettingsUpdate = () => {
      db.beforeSettingsUpdate = null;
      const row = settingsRow();
      Object.assign(row, { numbering: { ...row.numbering, prefix: "ZZ" }, revision: row.revision + 1 });
      db.resnapshot(); // the rival's commit survives our rollback
    };
    const res = await finalize(d.id);
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/no invoice number was used/i);
    expect(db.bills.get(d.id).status).toBe("DRAFT");
    expect(db.bills.get(d.id).billNumber ?? null).toBeNull();
    expect(JSON.stringify(db.counters)).toBe(counters);
    expect(settingsRow().numberingLocked).not.toBe(true);
    // trying again works, with the NEW numbering and the first number of that series
    const again = await finalize(d.id);
    expect(again.status).toBe(200);
    expect(again.body.data.billNumber).toBe(`ZZ/${FY()}/0001`);
    expect(settingsRow().numberingLocked).toBe(true);
  });

  it("a failure AFTER the lock write rolls the lock back too (no lock, no number)", async () => {
    await configure();
    const d = await draft();
    db.beforeBillUpdate = () => {
      db.beforeBillUpdate = null;
      throw new Error("database fault while finalizing");
    };
    expect((await finalize(d.id)).status).toBe(500);
    expect(settingsRow().numberingLocked).not.toBe(true);
    expect(db.bills.get(d.id).status).toBe("DRAFT");
    expect(db.bills.get(d.id).billNumber ?? null).toBeNull();
    expect((await patchSettings({ numbering: { prefix: "STILL" } })).status).toBe(200);
  });

  it("two first finalizes in a row get two numbers and one lock write", async () => {
    await configure();
    const a = await issued();
    const b = await issued();
    expect([a.billNumber, b.billNumber]).toEqual([`AC/${FY()}/0001`, `AC/${FY()}/0002`]);
  });

  it("the lock helper creates the settings document when none exists (revision 0, defaults) and then reports locked", async () => {
    const { lockNumbering, loadSettings } = await import("../services/invoiceSettings.service.js");
    expect(settingsRow()).toBeUndefined();
    await lockNumbering(await loadSettings(), null);
    expect(settingsRow()).toMatchObject({ numberingLocked: true, revision: 0 });
    expect((await loadSettings()).numberingLocked).toBe(true);
  });
});
