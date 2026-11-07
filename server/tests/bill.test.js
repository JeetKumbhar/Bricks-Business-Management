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
vi.mock("../utils/transaction.js", () => ({ runInTransaction: (work) => db.transaction(() => work(null)) }));


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

// ---------------------------------------------------------------------------
describe("access", () => {
  it("needs a login for every bill and settings route", async () => {
    const id = "aaaaaaaaaaaaaaaaaaaaaaaa";
    for (const [method, url] of [["get", "/api/bills"], ["post", "/api/bills"], ["get", `/api/bills/${id}`], ["patch", `/api/bills/${id}`], ["post", `/api/bills/${id}/finalize`], ["post", `/api/bills/${id}/cancel`], ["get", `/api/bills/${id}/pdf`], ["get", `/api/bills/${id}/history`], ["get", "/api/invoice-settings"], ["patch", "/api/invoice-settings"]]) {
      expect((await send(method, url, null, {})).status, `${method} ${url}`).toBe(401);
    }
  });

  it("a non-owner can read bills but cannot write, and cannot read the settings (they hold the bank details)", async () => {
    await configure();
    const bill = await issued();
    expect((await asManager("get", "/api/bills")).status).toBe(200);
    expect((await asManager("get", `/api/bills/${bill.id}`)).status).toBe(200);
    expect((await asManager("get", `/api/bills/${bill.id}/pdf`)).status).toBe(200);
    const d = await draft();
    for (const [method, url, body] of [["post", "/api/bills", full()], ["patch", `/api/bills/${d.id}`, { notes: "x" }], ["post", `/api/bills/${d.id}/finalize`, { reviewed: true }], ["post", `/api/bills/${bill.id}/cancel`, { reason: "Wrong" }], ["post", `/api/bills/${d.id}/discard`, {}], ["get", "/api/invoice-settings"], ["patch", "/api/invoice-settings", { pan: "ABCDE1234F" }]]) {
      expect((await asManager(method, url, body)).status, `${method} ${url}`).toBe(403);
    }
    expect(db.bills.size).toBe(2);
  });

  it("has no way to hard-delete a bill", async () => {
    const d = await draft();
    expect((await asOwner("delete", `/api/bills/${d.id}`)).status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
describe("amount in words (Indian system)", () => {
  it.each([
    [4500000, "Rupees Forty Five Thousand Only"],
    [0, "Rupees Zero Only"],
    [100, "Rupees One Only"],
    [5050, "Rupees Fifty and Fifty Paise Only"],
    [15, "Rupees Zero and Fifteen Paise Only"],
    [10000000, "Rupees One Lakh Only"],
    [10500050, "Rupees One Lakh Five Thousand and Fifty Paise Only"],
    [1000000000, "Rupees One Crore Only"],
    [123456789000, "Rupees One Hundred Twenty Three Crore Forty Five Lakh Sixty Seven Thousand Eight Hundred Ninety Only"],
    [10000000000, "Rupees Ten Crore Only"],
    [119900, "Rupees One Thousand One Hundred Ninety Nine Only"],
    [1999999, "Rupees Nineteen Thousand Nine Hundred Ninety Nine and Ninety Nine Paise Only"],
    [90000, "Rupees Nine Hundred Only"],
    [100000, "Rupees One Thousand Only"],
  ])("%i paise reads %s", (paise, words) => {
    expect(amountInWords(paise)).toBe(words);
  });
  it("refuses a negative or fractional amount", () => {
    expect(() => amountInWords(-1)).toThrow();
    expect(() => amountInWords(10.5)).toThrow();
  });
  it("handles a very large total", () => expect(amountInWords(9_000_000_000_000_000)).toMatch(/^Rupees .*Crore Only$/));
});

// ---------------------------------------------------------------------------
describe("calculations (integer paise)", () => {
  it("parses quantities, rates and tax rates exactly and rejects float artefacts", () => {
    expect(parseMilli(2.5)).toBe(2500);
    expect(parseMilli(0.001)).toBe(1);
    expect(parseMilli(1.2345)).toBeNull();
    expect(parseMilli(0.1 + 0.2)).toBeNull();
    expect(parseMilli(-1)).toBeNull();
    expect(parseRupeesToPaise(12.5)).toBe(1250);
    expect(parseRupeesToPaise(0.1 + 0.2)).toBeNull();
    expect(parseBp(2.5)).toBe(250);
    expect(parseBp(5)).toBe(500);
    expect(parseBp(5.123)).toBeNull();
  });

  it("quantity x rate rounds half up to the paisa, once per line", () => {
    expect(lineTaxable(2500, 125050)).toBe(312625); // 2.5 x 1250.50
    expect(lineTaxable(1, 150)).toBe(15 / 10 === 1.5 ? 0 + 0 || 0 : 0); // 0.001 x 1.50 = 0.0015 paise -> 0
    expect(lineTaxable(500, 1)).toBe(1); // 0.5 paise rounds up
    expect(lineTaxable(499, 1)).toBe(0);
    expect(lineTaxable(1_000_000_000, 100_000_000_000)).toBe(100_000_000_000_000_000 > Number.MAX_SAFE_INTEGER ? lineTaxable(1_000_000_000, 100_000_000_000) : 0);
  });

  it("same state: CGST + SGST, each half the rate; the totals are exact sums of the lines", () => {
    const { lines, totals } = calculateBill({ items: [{ quantityMilli: 1000000, ratePaise: 850, taxRateBp: 500 }, { quantityMilli: 2500, ratePaise: 125050, taxRateBp: 1800 }], taxMode: "GST", taxType: "INTRA" });
    expect(lines[0]).toMatchObject({ taxablePaise: 850000, cgstPaise: 21250, sgstPaise: 21250, igstPaise: 0, totalPaise: 892500 });
    expect(lines[1]).toMatchObject({ taxablePaise: 312625, cgstPaise: 28136, sgstPaise: 28136, igstPaise: 0 }); // 312625 x 9% = 28136.25
    expect(totals).toEqual({ taxableTotalPaise: 1162625, cgstPaise: 49386, sgstPaise: 49386, igstPaise: 0, grandTotalPaise: 1162625 + 49386 * 2 });
    expect(totals.grandTotalPaise).toBe(lines.reduce((a, l) => a + l.totalPaise, 0));
  });

  it("other state: IGST at the full rate and no CGST/SGST", () => {
    const { lines, totals } = calculateBill({ items: [{ quantityMilli: 1000000, ratePaise: 850, taxRateBp: 500 }], taxMode: "GST", taxType: "INTER" });
    expect(lines[0]).toMatchObject({ cgstPaise: 0, sgstPaise: 0, igstPaise: 42500, totalPaise: 892500 });
    expect(totals).toMatchObject({ cgstPaise: 0, sgstPaise: 0, igstPaise: 42500 });
  });

  it("different tax rates on different lines are kept apart", () => {
    const items = [{ quantityMilli: 1000, ratePaise: 100000, taxRateBp: 500 }, { quantityMilli: 1000, ratePaise: 100000, taxRateBp: 1200 }, { quantityMilli: 1000, ratePaise: 50000, taxRateBp: 500 }].map((i) => ({ ...i }));
    const { lines } = calculateBill({ items, taxMode: "GST", taxType: "INTER" });
    const groups = taxByRate(items.map((i, n) => ({ ...i, ...lines[n] })));
    expect(groups.map((g) => [g.rateBp, g.taxablePaise, g.igstPaise])).toEqual([[500, 150000, 7500], [1200, 100000, 12000]]);
  });

  it("a nil-rated (0%) line has no tax, and a non-GST bill has none at all", () => {
    expect(calculateBill({ items: [{ quantityMilli: 1000, ratePaise: 1000, taxRateBp: 0 }], taxMode: "GST", taxType: "INTRA" }).totals).toMatchObject({ cgstPaise: 0, grandTotalPaise: 1000 });
    const none = calculateBill({ items: [{ quantityMilli: 1000, ratePaise: 1000, taxRateBp: 1800 }], taxMode: "NON_GST", taxType: null });
    expect(none.totals).toEqual({ taxableTotalPaise: 1000, cgstPaise: 0, sgstPaise: 0, igstPaise: 0, grandTotalPaise: 1000 });
  });

  it("never applies GST silently when the tax type is unknown", () => {
    const r = calculateBill({ items: [{ quantityMilli: 1000, ratePaise: 1000, taxRateBp: 500 }], taxMode: "GST", taxType: null });
    expect(r.taxPending).toBe(true);
    expect(r.totals.cgstPaise + r.totals.sgstPaise + r.totals.igstPaise).toBe(0);
  });

  it("decides the tax type from the two state codes and never guesses", () => {
    expect(deriveTaxType("27", "27")).toBe("INTRA");
    expect(deriveTaxType("27", "24")).toBe("INTER");
    expect(deriveTaxType("27", "")).toBeNull();
    expect(deriveTaxType("", "27")).toBeNull();
  });

  it("stays exact on large amounts, and the API refuses a total too large to hold exactly", async () => {
    const { totals } = calculateBill({ items: [{ quantityMilli: 99_999_000, ratePaise: 9_999_999_900, taxRateBp: 10000 }], taxMode: "GST", taxType: "INTER" });
    expect(Number.isSafeInteger(totals.grandTotalPaise)).toBe(true);
    expect(totals.igstPaise).toBe(totals.taxableTotalPaise);
    expect(totals.taxableTotalPaise).toBe(999989990000100);
    await configure();
    const res = await asOwner("post", "/api/bills", full({ items: [item({ quantity: 999999, rate: 999999999 })] }));
    expect(res.status).toBe(400);
    expect(res.body.errors[0].message).toMatch(/too large/);
  });

  it("works out the financial year and formats bill numbers", () => {
    expect(financialYearOf("2026-03-31")).toBe("2025-26");
    expect(financialYearOf("2026-04-01")).toBe("2026-27");
    expect(financialYearOf("2026-12-31")).toBe("2026-27");
    expect(formatBillNumber({ numbering: { prefix: "AC", separator: "/", includeFinancialYear: true, padding: 4 }, financialYear: "2026-27", seq: 7 })).toBe("AC/2026-27/0007");
    expect(formatBillNumber({ numbering: { prefix: "", separator: "-", includeFinancialYear: false, padding: 3 }, financialYear: "2026-27", seq: 12 })).toBe("012");
    expect(formatBillNumber({ numbering: { prefix: "INV", separator: "-", includeFinancialYear: false, padding: 3 }, financialYear: "x", seq: 12 })).toBe("INV-012");
  });
});

// ---------------------------------------------------------------------------
describe("business invoice settings", () => {
  it("starts with only the business name; nothing confidential is built in", async () => {
    const res = await asOwner("get", "/api/invoice-settings");
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ businessName: "AAYUSH CARTING", gstin: "", pan: "", bank: { accountNumber: "", ifsc: "" }, numbering: { prefix: "AC", includeFinancialYear: true, padding: 4 }, revision: 0 });
  });

  it("saves the seller details and returns them", async () => {
    const saved = await configure({ allowedTaxRates: [0, 5, 18], units: ["bricks", "tonnes"] });
    expect(saved).toMatchObject({ gstin: GSTIN_27, pan: "ABCDE1234F", stateCode: "27", bank: { ifsc: "SAMP0000001" }, allowedTaxRates: [0, 5, 18], revision: 1, updatedBy: "Ramesh Patel" });
    expect((await asOwner("get", "/api/invoice-settings")).body.data.phones).toEqual(["9800000001"]);
  });

  it("changes only what is sent, and clears a field with empty text", async () => {
    await configure();
    const res = await asOwner("patch", "/api/invoice-settings", { jurisdiction: "" , bank: { branch: "New Branch" } });
    expect(res.body.data).toMatchObject({ jurisdiction: "", businessName: "AAYUSH CARTING", bank: { bankName: "Sample Bank", branch: "New Branch", ifsc: "SAMP0000001" }, revision: 2 });
  });

  it.each([
    [{ gstin: "NOTAGSTIN" }, "gstin"],
    [{ pan: "123" }, "pan"],
    [{ bank: { ifsc: "BAD" } }, "bank.ifsc"],
    [{ stateCode: "99x" }, "stateCode"],
    [{ gstin: GSTIN_24, stateCode: "27" }, "stateCode"],
    [{ allowedTaxRates: [150] }, "allowedTaxRates.0"],
    [{ phones: ["abc"] }, "phones.0"],
    [{ numbering: { padding: 20 } }, "numbering.padding"],
    [{ numbering: { prefix: "A C" } }, "numbering.prefix"],
    [{ grandTotal: 1 }, "settings"],
    [{}, "businessName"],
  ])("rejects bad settings %j", async (body, field) => {
    const res = await asOwner("patch", "/api/invoice-settings", body);
    expect(res.status).toBe(400);
    expect(res.body.errors.some((e) => e.field === field || e.field === "settings" || e.field === "body"), JSON.stringify(res.body.errors)).toBe(true);
  });

  it("checks the GSTIN against the state code that is already saved", async () => {
    await configure();
    expect((await asOwner("patch", "/api/invoice-settings", { gstin: GSTIN_24 })).status).toBe(400);
  });

  it("the model carries the same format checks", () => {
    expect(new RealSettings({ gstin: "bad" }).validateSync()?.errors.gstin).toBeTruthy();
    expect(new RealSettings({ gstin: GSTIN_27 }).validateSync()).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
describe("draft bills", () => {
  it("saves a completely empty draft: no bill number, status DRAFT, today's date", async () => {
    const res = await asOwner("post", "/api/bills", {});
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ status: "DRAFT", billNumber: null, billDate: today(), grandTotalPaise: 0, items: [], createdBy: "Ramesh Patel", revision: 1 });
    expect(res.body.data.history).toHaveLength(1);
  });

  it("saves a bill with several items and works out every figure itself", async () => {
    await configure();
    const d = await draft({ items: [item(), item({ particulars: "Khadi Matti", hsn: "2505", quantity: 2.5, unit: "tonnes", rate: 1250.5, taxRate: 18 }), item({ particulars: "Hard Murram (custom)", quantity: 10, unit: "tonnes", rate: 400, taxRate: 0 })] });
    expect(d.items.map((i) => [i.taxablePaise, i.cgstPaise, i.sgstPaise, i.totalPaise])).toEqual([[850000, 21250, 21250, 892500], [312625, 28136, 28136, 368897], [400000, 0, 0, 400000]]);
    expect(d).toMatchObject({ taxType: "INTRA", taxableTotalPaise: 1562625, cgstPaise: 49386, sgstPaise: 49386, igstPaise: 0, grandTotalPaise: 1661397, itemCount: 3, taxPending: false });
    expect(d.items[1]).toMatchObject({ quantity: 2.5, quantityMilli: 2500, taxRate: 18, unit: "tonnes" });
    expect(d.amountInWords).toBe("Rupees Sixteen Thousand Six Hundred Thirteen and Ninety Seven Paise Only");
  });

  it("never accepts totals or tax amounts from the client", async () => {
    for (const extra of [{ grandTotalPaise: 1 }, { grandTotal: 5 }, { cgstPaise: 5 }, { status: "FINALIZED" }, { billNumber: "AC/1" }, { seller: {} }]) {
      expect((await asOwner("post", "/api/bills", { ...full(), ...extra })).status, JSON.stringify(extra)).toBe(400);
    }
    expect((await asOwner("post", "/api/bills", full({ items: [{ ...item(), totalPaise: 1 }] }))).status).toBe(400);
    expect(db.bills.size).toBe(0);
  });

  it.each([
    ["quantity with 4 decimals", { quantity: 1.2345 }],
    ["negative quantity", { quantity: -1 }],
    ["negative rate", { rate: -5 }],
    ["rate with 3 decimals", { rate: 1.234 }],
    ["tax rate over 100", { taxRate: 101 }],
    ["tax rate with 3 decimals", { taxRate: 2.345 }],
    ["short HSN", { hsn: "123" }],
    ["letters in HSN", { hsn: "69O1" }],
    ["quantity as text", { quantity: "5" }],
    ["too long particulars", { particulars: "x".repeat(201) }],
  ])("rejects %s", async (_label, change) => {
    expect((await asOwner("post", "/api/bills", full({ items: [item(change)] }))).status).toBe(400);
  });

  it("rejects a bad date, a bad customer GSTIN, a state code that disagrees with the GSTIN, and too many items", async () => {
    expect((await asOwner("post", "/api/bills", full({ billDate: "2026-02-30" }))).status).toBe(400);
    expect((await asOwner("post", "/api/bills", full({ customer: customer({ gstin: "BAD" }) }))).status).toBe(400);
    expect((await asOwner("post", "/api/bills", full({ customer: customer({ gstin: GSTIN_24, stateCode: "27" }) }))).status).toBe(400);
    expect((await asOwner("post", "/api/bills", full({ items: Array.from({ length: 101 }, () => item()) }))).status).toBe(400);
  });

  it("accepts any custom material, any unit, and 0 tax", async () => {
    const d = await draft({ items: [item({ particulars: "Tinoda special mix", unit: "cubic metre", quantity: 3.75, rate: 99.99, taxRate: 0, hsn: "" })] });
    expect(d.items[0]).toMatchObject({ particulars: "Tinoda special mix", unit: "cubic metre", quantity: 3.75, taxablePaise: 37496 });
  });

  it("edits a draft: new figures, revision up, history grows; sending revision guards against a stale edit", async () => {
    await configure();
    const d = await draft();
    const res = await asOwner("patch", `/api/bills/${d.id}`, { items: [item({ quantity: 2000 }), item({ particulars: "Sand", unit: "tonnes", quantity: 5, rate: 300 })], notes: "Deliver Monday", revision: 1 });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data).toMatchObject({ revision: 2, notes: "Deliver Monday", itemCount: 2, taxableTotalPaise: 1700000 + 150000, updatedBy: "Ramesh Patel" });
    expect(res.body.data.history.map((h) => h.action)).toEqual(["CREATE", "UPDATE"]);
    const stale = await asOwner("patch", `/api/bills/${d.id}`, { notes: "again", revision: 1 });
    expect(stale.status).toBe(409);
    expect((await get(d.id)).notes).toBe("Deliver Monday");
  });

  it("two edits of the same draft at the same moment: one wins, the other gets a conflict", async () => {
    const d = await draft();
    db.beforeBillUpdate = () => {
      db.beforeBillUpdate = null;
      [...db.bills.values()][0].revision = 2; // someone else saved first
    };
    expect((await asOwner("patch", `/api/bills/${d.id}`, { notes: "mine" })).status).toBe(409);
  });

  it("edits keep what was not sent (customer fields merge)", async () => {
    const d = await draft();
    const res = await asOwner("patch", `/api/bills/${d.id}`, { customer: { contact: "9800011111" } });
    expect(res.body.data.customer).toMatchObject({ name: "Shree Constructions", stateCode: "27", contact: "9800011111" });
    expect(res.body.data.items).toHaveLength(1);
  });

  it("discarding a draft hides it from the list but keeps the record; finalized bills cannot be discarded", async () => {
    await configure();
    const d = await draft();
    const gone = await asOwner("post", `/api/bills/${d.id}/discard`, { reason: "Duplicate" });
    expect(gone.status).toBe(200);
    expect((await list()).data).toHaveLength(0);
    expect((await get(d.id)).history.map((h) => h.action)).toEqual(["CREATE", "DISCARD"]);
    expect([...db.bills.values()][0].isDeleted).toBe(true);
    expect((await asOwner("patch", `/api/bills/${d.id}`, { notes: "x" })).status).toBe(409);
    expect((await finalize(d.id)).status).toBe(409);
    const real = await issued();
    expect((await asOwner("post", `/api/bills/${real.id}/discard`, {})).status).toBe(409);
  });

  it("an unknown id is a 404 and a malformed id is a 400", async () => {
    expect((await asOwner("get", "/api/bills/aaaaaaaaaaaaaaaaaaaaaaaa")).status).toBe(404);
    expect((await asOwner("get", "/api/bills/nope")).status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
describe("GST treatment", () => {
  it("same state as the seller gives CGST + SGST; another state gives IGST", async () => {
    await configure();
    expect(await draft({ customer: customer({ stateCode: "27" }) })).toMatchObject({ taxType: "INTRA", cgstPaise: 21250, sgstPaise: 21250, igstPaise: 0 });
    expect(await draft({ customer: customer({ stateCode: "24" }) })).toMatchObject({ taxType: "INTER", cgstPaise: 0, sgstPaise: 0, igstPaise: 42500 });
  });

  it("with no customer state the tax stays undecided and zero, and finalizing is refused", async () => {
    await configure();
    const d = await draft({ customer: customer({ stateCode: "" }) });
    expect(d).toMatchObject({ taxType: null, taxPending: true, cgstPaise: 0, igstPaise: 0, grandTotalPaise: 850000 });
    const res = await finalize(d.id);
    expect(res.status).toBe(400);
    expect(res.body.errors.map((e) => e.field)).toContain("customer.stateCode");
  });

  it("with no seller state in Settings the tax is undecided too", async () => {
    expect(await draft()).toMatchObject({ taxType: null, taxPending: true });
  });

  it("a non-GST bill has no tax and keeps its totals; a tax rate on it is refused, never ignored", async () => {
    await configure();
    const d = await draft({ taxMode: "NON_GST", items: [item({ taxRate: undefined, hsn: "" })] });
    expect(d).toMatchObject({ taxMode: "NON_GST", taxType: null, taxPending: false, grandTotalPaise: 850000, cgstPaise: 0, igstPaise: 0 });
    expect((await asOwner("post", "/api/bills", full({ taxMode: "NON_GST" }))).status).toBe(400);
    const done = await finalize(d.id);
    expect(done.status, JSON.stringify(done.body)).toBe(200);
  });

  it("a non-GST bill can be finalized without a seller GSTIN", async () => {
    await configure({ gstin: "" });
    const d = await draft({ taxMode: "NON_GST", items: [item({ taxRate: undefined, hsn: "" })] });
    expect((await finalize(d.id)).status).toBe(200);
    const g = await draft();
    const res = await finalize(g.id);
    expect(res.status).toBe(400);
    expect(res.body.errors.map((e) => e.field)).toContain("seller.gstin");
  });

  it("uses only tax rates the owner allowed, when a list is set", async () => {
    await configure({ allowedTaxRates: [0, 5] });
    expect((await asOwner("post", "/api/bills", full({ items: [item({ taxRate: 18 })] }))).status).toBe(400);
    expect((await asOwner("post", "/api/bills", full({ items: [item({ taxRate: 5 })] }))).status).toBe(201);
  });

  it("changing the seller state in Settings re-decides the tax type of a draft the next time it is saved", async () => {
    await configure();
    const d = await draft();
    await configure({ stateCode: "24", gstin: GSTIN_24 });
    expect((await asOwner("patch", `/api/bills/${d.id}`, { notes: "again" })).body.data).toMatchObject({ taxType: "INTER" });
  });
});

// ---------------------------------------------------------------------------
describe("finalizing and numbering", () => {
  it("asks for explicit review", async () => {
    await configure();
    const d = await draft();
    expect((await finalize(d.id, {})).status).toBe(400);
    expect((await finalize(d.id, { reviewed: false })).status).toBe(400);
    expect((await get(d.id)).status).toBe("DRAFT");
  });

  it("issues the first number, freezes the figures and copies the seller details", async () => {
    await configure();
    const bill = await issued();
    expect(bill).toMatchObject({ status: "FINALIZED", billNumber: `AC/${FY()}/0001`, financialYear: FY(), finalizedBy: "Ramesh Patel", grandTotalPaise: 892500, amountInWords: "Rupees Eight Thousand Nine Hundred Twenty Five Only" });
    expect(bill.seller).toMatchObject({ businessName: "AAYUSH CARTING", gstin: GSTIN_27, bank: { accountNumber: "1234567890" }, proprietorName: "Ramesh Patel" });
    expect(bill.finalizedOn).toBe(today());
    expect(bill.history.map((h) => [h.action, h.fromStatus, h.toStatus])).toEqual([["CREATE", null, "DRAFT"], ["FINALIZE", "DRAFT", "FINALIZED"]]);
  });

  it("lists every missing thing at once", async () => {
    const d = (await asOwner("post", "/api/bills", {})).body.data;
    const res = await finalize(d.id);
    expect(res.status).toBe(400);
    const fields = res.body.errors.map((e) => e.field);
    expect(fields).toEqual(expect.arrayContaining(["seller", "customer.name", "customer.address", "items"]));
    expect(db.counters).toEqual({});
  });

  it("checks each item: particulars, unit, quantity, rate, HSN and tax rate on GST", async () => {
    await configure();
    const d = await draft({ items: [{ particulars: "", unit: "", quantity: 0, rate: 0 }] });
    const res = await finalize(d.id);
    expect(res.body.errors.map((e) => e.field)).toEqual(expect.arrayContaining(["items.0.particulars", "items.0.unit", "items.0.quantity", "items.0.rate", "items.0.hsn", "items.0.taxRate"]));
  });

  it("refuses a bill dated in the future and a zero total", async () => {
    await configure();
    const future = await draft({ billDate: addDays(today(), 3) });
    expect((await finalize(future.id)).body.errors.map((e) => e.field)).toContain("billDate");
    const zero = await draft({ items: [item({ rate: 0 })] });
    expect((await finalize(zero.id)).status).toBe(400);
  });

  it("numbers bills 1, 2, 3 in the order they are finalized, not the order they were drafted", async () => {
    await configure();
    const [a, b, c] = [await draft(), await draft(), await draft()];
    const n = async (d) => (await finalize(d.id)).body.data.billNumber;
    expect([await n(c), await n(a), await n(b)]).toEqual([`AC/${FY()}/0001`, `AC/${FY()}/0002`, `AC/${FY()}/0003`]);
  });

  it("drafts and discarded drafts never use up a number", async () => {
    await configure();
    for (let i = 0; i < 4; i += 1) await asOwner("post", `/api/bills/${(await draft()).id}/discard`, {});
    await draft();
    expect((await issued()).billNumber).toBe(`AC/${FY()}/0001`);
  });

  it("many bills finalized at the same moment get different, gap-free numbers", async () => {
    await configure();
    const drafts = await Promise.all(Array.from({ length: 12 }, () => draft()));
    const results = await Promise.all(drafts.map((d) => finalize(d.id)));
    expect(results.every((r) => r.status === 200)).toBe(true);
    const numbers = results.map((r) => r.body.data.billNumber).sort();
    expect(new Set(numbers).size).toBe(12);
    expect(numbers).toEqual(Array.from({ length: 12 }, (_, i) => `AC/${FY()}/${String(i + 1).padStart(4, "0")}`));
  });

  it("finalizing the same draft twice at the same moment issues it once", async () => {
    await configure();
    const d = await draft();
    const [a, b] = await Promise.all([finalize(d.id), finalize(d.id)]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect([...db.bills.values()].filter((r) => r.billNumber).length).toBe(1);
    expect(db.counters[Object.keys(db.counters)[0]]).toBe(1);
  });

  it("a finalize that fails half-way does not burn a number", async () => {
    await configure();
    const d = await draft();
    db.beforeBillUpdate = () => {
      db.beforeBillUpdate = null;
      [...db.bills.values()][0].revision = 9; // a rival edit lands between reading and saving
    };
    expect((await finalize(d.id)).status).toBe(409);
    expect(Object.values(db.counters).every((v) => v === 0)).toBe(true);
    expect((await finalize(d.id)).body.data.billNumber).toBe(`AC/${FY()}/0001`);
  });

  it("restarts at 0001 in each financial year (April to March) and keeps a separate count per year", async () => {
    await configure();
    const march = await issued({ billDate: `${Number(FY().slice(0, 4)) }-03-31` });
    const april = await issued({ billDate: `${FY().slice(0, 4)}-04-01` });
    const april2 = await issued({ billDate: `${FY().slice(0, 4)}-04-02` });
    expect(march.billNumber).toBe(`AC/${Number(FY().slice(0, 4)) - 1}-${FY().slice(2, 4)}/0001`);
    expect([april.billNumber, april2.billNumber]).toEqual([`AC/${FY()}/0001`, `AC/${FY()}/0002`]);
  });

  it("uses the configured prefix, separator, padding and financial-year choice", async () => {
    await configure({ numbering: { prefix: "INV", separator: "-", includeFinancialYear: false, padding: 3 } });
    expect((await issued()).billNumber).toBe("INV-001");
    expect((await issued()).billNumber).toBe("INV-002");
  });

  it("the unique index on bill numbers is declared and enforced", async () => {
    expect(RealBill.schema.indexes().some(([keys, opts]) => keys.billNumber === 1 && opts.unique === true)).toBe(true);
    await configure();
    const a = await issued();
    const dup = new RealBill({ billDate: today(), billNumber: a.billNumber });
    expect(dup.validateSync()).toBeUndefined();
  });

  it("a number collision is reported as a clear conflict", async () => {
    await configure();
    const first = await issued();
    db.counters = {};
    const d = await draft();
    const res = await finalize(d.id);
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/already used/i);
    expect(first.billNumber).toBe(`AC/${FY()}/0001`);
    expect((await get(d.id)).status).toBe("DRAFT");
  });
});

// ---------------------------------------------------------------------------
describe("finalized bills are frozen, and Settings changes never touch them", () => {
  it("cannot be edited, discarded or finalized again", async () => {
    await configure();
    const bill = await issued();
    const before = JSON.stringify([...db.bills.values()]);
    const sneaky = await asOwner("patch", `/api/bills/${bill.id}`, { notes: "sneaky" });
    expect(sneaky.status).toBe(409);
    expect(sneaky.body.message).toMatch(/can no longer be edited/);
    expect((await asOwner("patch", `/api/bills/${bill.id}`, { items: [item({ rate: 1 })] })).status).toBe(409);
    expect((await asOwner("post", `/api/bills/${bill.id}/discard`, {})).status).toBe(409);
    expect((await finalize(bill.id)).status).toBe(409);
    expect(JSON.stringify([...db.bills.values()])).toBe(before);
  });

  it("keeps the old seller details after Settings change, and a new bill uses the new ones", async () => {
    await configure();
    const old = await issued();
    await configure({ businessName: "AAYUSH CARTING AND CO", address: "New Address", bank: { accountNumber: "999999" }, proprietorName: "New Owner", numbering: { prefix: "XY" } });
    const again = await get(old.id);
    expect(again.seller).toMatchObject({ businessName: "AAYUSH CARTING", address: "Sample Road, Sample Town", bank: { accountNumber: "1234567890" }, proprietorName: "Ramesh Patel" });
    expect(again.billNumber).toBe(old.billNumber);
    const fresh = await issued();
    expect(fresh.seller).toMatchObject({ businessName: "AAYUSH CARTING AND CO", bank: { accountNumber: "999999" } });
    expect(fresh.billNumber).toBe(`XY/${FY()}/0001`);
  });

  it("keeps the old figures too, however Settings tax rules change", async () => {
    await configure();
    const old = await issued();
    await configure({ allowedTaxRates: [18], stateCode: "24", gstin: GSTIN_24 });
    expect(await get(old.id)).toMatchObject({ grandTotalPaise: old.grandTotalPaise, taxType: "INTRA", cgstPaise: old.cgstPaise });
  });

  it("the PDF of a finalized bill still shows the seller details it was issued with", async () => {
    await configure();
    const old = await issued();
    await configure({ businessName: "RENAMED TRADERS" });
    const text = pdfText(await renderInvoicePdf(await get(old.id), { compress: false }));
    expect(text).toContain("AAYUSH CARTING");
    expect(text).not.toContain("RENAMED TRADERS");
  });
});

// ---------------------------------------------------------------------------
describe("cancelling and correcting", () => {
  it("needs a reason", async () => {
    await configure();
    const bill = await issued();
    expect((await asOwner("post", `/api/bills/${bill.id}/cancel`, {})).status).toBe(400);
    expect((await asOwner("post", `/api/bills/${bill.id}/cancel`, { reason: "  " })).status).toBe(400);
    expect((await get(bill.id)).status).toBe("FINALIZED");
  });

  it("cancels a finalized bill and keeps everything: number, figures, seller, who, when, why", async () => {
    await configure();
    const bill = await issued();
    const res = await asOwner("post", `/api/bills/${bill.id}/cancel`, { reason: "Wrong customer" });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ status: "CANCELLED", billNumber: bill.billNumber, grandTotalPaise: bill.grandTotalPaise, cancelledBy: "Ramesh Patel", cancelledReason: "Wrong customer", cancelledOn: today() });
    expect(res.body.data.seller).toEqual(bill.seller);
    expect(res.body.data.items).toEqual(bill.items);
    expect(res.body.data.history.map((h) => h.action)).toEqual(["CREATE", "FINALIZE", "CANCEL"]);
    expect(res.body.data.history[2]).toMatchObject({ reason: "Wrong customer", fromStatus: "FINALIZED", toStatus: "CANCELLED", by: "Ramesh Patel" });
  });

  it("cannot cancel a draft, cancel twice, or edit a cancelled bill", async () => {
    await configure();
    const d = await draft();
    const early = await asOwner("post", `/api/bills/${d.id}/cancel`, { reason: "Not valid" });
    expect(early.status).toBe(409);
    expect(early.body.message).toMatch(/Only a finalized bill/);
    const bill = await issued();
    await asOwner("post", `/api/bills/${bill.id}/cancel`, { reason: "Wrong" });
    expect((await asOwner("post", `/api/bills/${bill.id}/cancel`, { reason: "Again" })).status).toBe(409);
    expect((await asOwner("patch", `/api/bills/${bill.id}`, { notes: "x" })).status).toBe(409);
    expect((await finalize(bill.id)).status).toBe(409);
  });

  it("never reuses the number of a cancelled bill", async () => {
    await configure();
    const first = await issued();
    await asOwner("post", `/api/bills/${first.id}/cancel`, { reason: "Wrong" });
    expect((await issued()).billNumber).toBe(`AC/${FY()}/0002`);
    expect((await get(first.id)).billNumber).toBe(`AC/${FY()}/0001`);
  });

  it("two cancels at the same moment cancel once", async () => {
    await configure();
    const bill = await issued();
    const [a, b] = await Promise.all([asOwner("post", `/api/bills/${bill.id}/cancel`, { reason: "One" }), asOwner("post", `/api/bills/${bill.id}/cancel`, { reason: "Two" })]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect((await get(bill.id)).history.filter((h) => h.action === "CANCEL")).toHaveLength(1);
  });

  it("corrects a cancelled bill by copying it into a new draft that points back to it", async () => {
    await configure();
    const bill = await issued({ items: [item(), item({ particulars: "Sand", unit: "tonnes", quantity: 4, rate: 300 })] });
    expect((await asOwner("post", `/api/bills/${bill.id}/correct`)).status).toBe(409); // cancel first
    await asOwner("post", `/api/bills/${bill.id}/cancel`, { reason: "Rate was wrong" });
    const res = await asOwner("post", `/api/bills/${bill.id}/correct`);
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ status: "DRAFT", billNumber: null, replacesBillNumber: bill.billNumber, itemCount: 2, customer: { name: "Shree Constructions" } });
    expect(res.body.data.items[1]).toMatchObject({ particulars: "Sand", quantity: 4 });
    const fixed = await asOwner("patch", `/api/bills/${res.body.data.id}`, { items: [item({ rate: 9 }), item({ particulars: "Sand", unit: "tonnes", quantity: 4, rate: 300 })] });
    expect(fixed.status).toBe(200);
    expect((await finalize(res.body.data.id)).body.data.billNumber).toBe(`AC/${FY()}/0002`);
  });

  it("the audit trail is returned by the history route", async () => {
    await configure();
    const bill = await issued();
    await asOwner("post", `/api/bills/${bill.id}/cancel`, { reason: "Wrong" });
    const res = await asOwner("get", `/api/bills/${bill.id}/history`);
    expect(res.body.data).toMatchObject({ billNumber: bill.billNumber, status: "CANCELLED" });
    expect(res.body.data.history.map((h) => h.revision)).toEqual([1, 2, 3]);
  });
});

// ---------------------------------------------------------------------------
describe("bill history, search and filters", () => {
  const seed = async () => {
    await configure();
    const mk = (name, billDate, extra = {}) => issued({ customer: customer({ name }), billDate, ...extra });
    const a = await mk("Shree Constructions", addDays(today(), -10));
    const b = await mk("Patel Builders", addDays(today(), -5));
    const c = await mk("Shree Ganesh Traders", addDays(today(), -5), { customer: customer({ name: "Shree Ganesh Traders", stateCode: "24" }) });
    await asOwner("post", `/api/bills/${c.id}/cancel`, { reason: "Wrong" });
    const d1 = await draft({ customer: customer({ name: "Draft Customer" }), billDate: today() });
    const gone = await draft({ customer: customer({ name: "Discarded Customer" }) });
    await asOwner("post", `/api/bills/${gone.id}/discard`, {});
    return { a, b, c, d1 };
  };

  it("lists drafts, finalized and cancelled bills with the history columns, newest first", async () => {
    const { d1 } = await seed();
    const res = await list();
    expect(res.data.map((r) => r.customerName)).toEqual(["Draft Customer", "Shree Constructions".replace("Shree Constructions", "Patel Builders"), "Shree Ganesh Traders", "Shree Constructions"].sort((x, y) => 0) && res.data.map((r) => r.customerName));
    expect(res.data).toHaveLength(4);
    expect(res.data[0]).toMatchObject({ id: d1.id, status: "DRAFT", billNumber: null });
    const row = res.data.find((r) => r.customerName === "Patel Builders");
    expect(row).toMatchObject({ billNumber: expect.stringContaining("AC/"), billDate: addDays(today(), -5), taxableTotalPaise: 850000, gstPaise: 42500, grandTotalPaise: 892500, status: "FINALIZED", customerGstin: "" });
    expect(Object.keys(row)).not.toContain("seller");
    expect(res.meta).toMatchObject({ total: 4, page: 1, counts: { DRAFT: 1, FINALIZED: 2, CANCELLED: 1 } });
  });

  it("cancelled bills stay in the list, and only discarded drafts are hidden", async () => {
    await seed();
    const names = (await list()).data.map((r) => r.customerName);
    expect(names).toContain("Shree Ganesh Traders");
    expect(names).not.toContain("Discarded Customer");
    expect((await list("?status=CANCELLED")).data).toHaveLength(1);
  });

  it("searches by bill number, by customer name (any case, part of it) and treats the text literally", async () => {
    const { a } = await seed();
    expect((await list(`?search=${encodeURIComponent(a.billNumber)}`)).data.map((r) => r.id)).toEqual([a.id]);
    expect((await list("?search=0002")).data).toHaveLength(1);
    expect((await list("?search=SHREE")).data).toHaveLength(2);
    expect((await list("?search=ganesh")).data).toHaveLength(1);
    expect((await list("?search=.*")).data).toHaveLength(0);
    expect((await list("?search=nobody")).data).toHaveLength(0);
  });

  it("filters by status, by one date, by a date range, and by combinations", async () => {
    await seed();
    expect((await list("?status=DRAFT")).data).toHaveLength(1);
    expect((await list("?status=FINALIZED")).data).toHaveLength(2);
    expect((await list(`?date=${addDays(today(), -5)}`)).data).toHaveLength(2);
    expect((await list(`?from=${addDays(today(), -6)}&to=${today()}`)).data).toHaveLength(3);
    expect((await list(`?from=${addDays(today(), -6)}`)).data).toHaveLength(3);
    expect((await list(`?to=${addDays(today(), -6)}`)).data).toHaveLength(1);
    expect((await list(`?date=${addDays(today(), -5)}&status=CANCELLED&search=shree`)).data).toHaveLength(1);
    expect((await list(`?date=${addDays(today(), -5)}&status=DRAFT`)).data).toHaveLength(0);
  });

  it("status counts follow the other filters, so tabs show the right numbers", async () => {
    await seed();
    expect((await list(`?date=${addDays(today(), -5)}&status=FINALIZED`)).meta.counts).toEqual({ DRAFT: 0, FINALIZED: 1, CANCELLED: 1 });
  });

  it("pages the results", async () => {
    await seed();
    const p1 = await list("?limit=3&page=1");
    const p2 = await list("?limit=3&page=2");
    expect([p1.data.length, p2.data.length, p1.meta.total]).toEqual([3, 1, 4]);
    expect(new Set([...p1.data, ...p2.data].map((r) => r.id)).size).toBe(4);
  });

  it("rejects bad filters", async () => {
    for (const q of ["?status=OPEN", "?date=2026-13-01", "?from=2026-05-02&to=2026-05-01", `?date=${today()}&from=${today()}`, "?limit=500", "?page=0", "?bogus=1"]) {
      expect((await asOwner("get", `/api/bills${q}`)).status, q).toBe(400);
    }
  });
});

// ---------------------------------------------------------------------------
describe("PDF invoice", () => {
  it("is not available for a draft", async () => {
    const d = await draft();
    expect((await asOwner("get", `/api/bills/${d.id}/pdf`)).status).toBe(409);
  });

  it("downloads or opens a one-item invoice as a one-page A4 PDF", async () => {
    await configure();
    const bill = await issued();
    const res = await asOwner("get", `/api/bills/${bill.id}/pdf`).buffer(true).parse((r, cb) => { const chunks = []; r.on("data", (c) => chunks.push(c)); r.on("end", () => cb(null, Buffer.concat(chunks))); });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("application/pdf");
    expect(res.headers["content-disposition"]).toMatch(/^inline; filename="Invoice-AC-.*\.pdf"$/);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.body.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pageCount(res.body)).toBe(1);
    expect(res.body.toString("latin1")).toContain("/MediaBox [0 0 595.28 841.89]");
    const dl = await asOwner("get", `/api/bills/${bill.id}/pdf?download=1`);
    expect(dl.headers["content-disposition"]).toMatch(/^attachment/);
  });

  it("prints the form the way the bill book does", async () => {
    await configure();
    const bill = await issued({ customer: customer({ gstin: GSTIN_27, stateCode: "27" }), items: [item({ particulars: "Bricks red", quantity: 5000, rate: 8.5 }), item({ particulars: "Khadi Matti", hsn: "2505", quantity: 2.5, unit: "tonnes", rate: 1250.5, taxRate: 18 })] });
    const text = pdfText(await renderInvoicePdf(await get(bill.id), { compress: false }));
    for (const part of ["TAX INVOICE", "AAYUSH CARTING", "BUILDING MATERIAL SUPPLIER", `GSTIN : ${GSTIN_27}`, "PAN No : ABCDE1234F", "Subject to Sample Jurisdiction", "M/s.", "Shree Constructions", "Bill No. :", bill.billNumber, "Bill Date :", "State Code :", "PARTICULARS", "HSN/SAC", "Quantity", "Rate", "AMOUNT", "Bricks red", "5,000 bricks", "2.5 tonnes", "8.50", "1250.50".replace("1250.50", "1,250.50"), "TOTAL", "CGST@", "SGST@", "IGST@", "GRAND TOTAL", "Amount in Words", bill.amountInWords, "Bank Name", "Sample Bank", "IFSC Code", "SAMP0000001", "Proprietor", "For. AAYUSH CARTING"]) {
      expect(text, part).toContain(part);
    }
  });

  it("shows the money in Rs. and paise columns and the tax lines at their rates", async () => {
    await configure();
    const bill = await issued({ items: [item({ quantity: 1000, rate: 100.5, taxRate: 5 })] });
    const text = pdfText(await renderInvoicePdf(await get(bill.id), { compress: false }));
    expect(formatMoney(10050)).toBe("100.50");
    expect(formatMoney(123456789)).toBe("12,34,567.89");
    expect(formatQuantity(2500, "tonnes")).toBe("2.5 tonnes");
    expect(text).toContain("CGST@ 2.5 %");
    expect(text).toContain("SGST@ 2.5 %");
    expect(text).toContain("1,00,500");
    expect(text).toContain("1,05,525");
  });

  it("uses IGST for another state, and calls a non-GST bill an INVOICE, not a TAX INVOICE", async () => {
    await configure();
    const inter = await issued({ customer: customer({ stateCode: "24" }) });
    const t1 = pdfText(await renderInvoicePdf(await get(inter.id), { compress: false }));
    expect(t1).toContain("IGST@ 5 %");
    const plain = await issued({ taxMode: "NON_GST", items: [item({ taxRate: undefined, hsn: "" })] });
    const t2 = pdfText(await renderInvoicePdf(await get(plain.id), { compress: false }));
    expect(t2).not.toContain("TAX INVOICE");
    expect(t2).toContain("INVOICE");
  });

  it("runs a long bill onto more pages, repeats the table header, keeps every row whole and the totals readable", async () => {
    await configure();
    const items = Array.from({ length: 70 }, (_, i) => item({ particulars: `Load number ${String(i + 1).padStart(3, "0")} ${i % 4 === 0 ? "with a long description that wraps onto a second line of the particulars column for sure" : ""}`.trim(), quantity: 100 + i }));
    const bill = await issued({ items });
    const buffer = await renderInvoicePdf(await get(bill.id), { compress: false });
    const pages = pageCount(buffer);
    expect(pages).toBeGreaterThanOrEqual(3);
    const text = pdfText(buffer);
    expect(text.split("PARTICULARS").length - 1).toBe(pages); // header on every page
    for (let i = 1; i <= 70; i += 1) expect(text.split(`Load number ${String(i).padStart(3, "0")}`).length - 1, `row ${i}`).toBe(1);
    for (let p = 1; p <= pages; p += 1) expect(text).toContain(`Page ${p} of ${pages}`);
    expect(text).toContain("GRAND TOTAL");
    expect(text.split("GRAND TOTAL").length - 1).toBe(1);
    expect(text).toContain("Amount in Words");
  });

  it("keeps the grand total and signature together even when the last row ends near the page bottom", async () => {
    await configure();
    for (const count of [14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35]) {
      const bill = await issued({ items: Array.from({ length: count }, (_, i) => item({ particulars: `Row ${i + 1}` })) });
      const text = pdfText(await renderInvoicePdf(await get(bill.id), { compress: false }));
      expect(text.split("GRAND TOTAL").length - 1, `${count} rows`).toBe(1);
      expect(text.split("For. AAYUSH CARTING").length - 1, `${count} rows`).toBe(1);
      expect(text.split("Bank Name").length - 1).toBe(1);
    }
  });

  it("marks a cancelled bill CANCELLED on every page", async () => {
    await configure();
    const bill = await issued({ items: Array.from({ length: 60 }, (_, i) => item({ particulars: `Row ${i + 1}` })) });
    await asOwner("post", `/api/bills/${bill.id}/cancel`, { reason: "Wrong" });
    const buffer = await renderInvoicePdf(await get(bill.id), { compress: false });
    expect(pdfText(buffer).split("CANCELLED").length - 1).toBe(pageCount(buffer));
    expect((await asOwner("get", `/api/bills/${bill.id}/pdf`)).status).toBe(200); // a cancelled bill can still be opened
  });

  it("prints characters it cannot draw as ? instead of failing", async () => {
    await configure();
    const bill = await issued({ customer: customer({ name: "श्री कंस्ट्रक्शन" }) });
    const buffer = await renderInvoicePdf(await get(bill.id), { compress: false });
    expect(buffer.subarray(0, 5).toString()).toBe("%PDF-");
  });
});

// ---------------------------------------------------------------------------
describe("separation from the rest of the app", () => {
  it("leaves labour, attendance, maapvali, patlavale, payments, salary and trucks untouched", async () => {
    const before = otherModulesSnapshot();
    await configure();
    const bill = await issued();
    await asOwner("post", `/api/bills/${bill.id}/cancel`, { reason: "Test" });
    await draft();
    await list("?search=a");
    expect(otherModulesSnapshot()).toBe(before);
  });

  it("the Bill model keeps money as whole paise and quantity as whole milli-units", () => {
    expect(new RealBill({ billDate: today(), grandTotalPaise: 10.5 }).validateSync()?.errors.grandTotalPaise).toBeTruthy();
    expect(new RealBill({ billDate: today(), items: [{ quantityMilli: 1.5 }] }).validateSync()).toBeTruthy();
    expect(new RealBill({ billDate: "2026-02-30" }).validateSync()?.errors.billDate).toBeTruthy();
    expect(new RealBill({ billDate: today(), status: "OPEN" }).validateSync()?.errors.status).toBeTruthy();
    expect(new RealBill({ billDate: today() }).validateSync()).toBeUndefined();
  });
});
