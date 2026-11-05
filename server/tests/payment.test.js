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
const { db, makeAttendanceModel, makeCounterModel, makeLabourModel, makeMaapEntryModel, makePaymentModel, makeProductionEntryModel, makeRateModel, makeSeasonModel } = await import("./helpers/memoryDb.js");
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

const { createApp } = await import("../app.js");
const { signAccessToken } = await import("../services/auth.service.js");
const { summarizePayments, balancePaise } = await import("../services/paymentCalculations.js");
const { ACCOUNTING_POLICY, countsAsReceived } = await import("../constants/payments.js");
const { addDays, todayBusinessDate } = await import("../utils/dates.js");
const RealPayment = (await vi.importActual("../models/Payment.js")).default;

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

const pay = (recipient, o = {}) => asOwner("post", "/api/payments", { recipientId: recipient.id, type: "SALARY_PAYMENT", amount: 1000, date: today, ...o });
const paid = async (recipient, o = {}) => {
  const res = await pay(recipient, o);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.data;
};
const balanceOf = async (labour) => (await asOwner("get", `/api/labours/${labour.id}/balance`)).body.data;
const liveRows = () => [...db.payments.values()].filter((r) => !r.isDeleted);

// work helpers (the earnings side of a balance)
const setupWork = async () => {
  const season = await asOwner("post", "/api/seasons", { name: "Season 2026-27", startDate: daysAgo(90) });
  expect(season.status).toBe(201);
  const bigari = await makeLabour("BIGARI");
  const maapvali = await makeLabour("MAAPVALI");
  const patlavale = await makeLabour("PATLAVALE");
  const att = (date, status) => asOwner("put", `/api/attendance/${date}`, { entries: [{ labourId: bigari.id, status }], reason: "Late entry" });
  for (const [d, s] of [[3, "PRESENT"], [2, "PRESENT"], [1, "PRESENT"], [4, "HALF_DAY"], [5, "ABSENT"]]) expect((await att(daysAgo(d), s)).status).toBe(200);
  expect((await asOwner("put", `/api/maap-entries/day/${today}`, { rows: [{ labourId: maapvali.id, maaps: 10 }] })).status).toBe(200);
  expect((await asOwner("put", `/api/production-entries/day/${today}`, { rows: [{ teamId: patlavale.id, maaps: 5 }] })).status).toBe(200);
  return { season: season.body.data, bigari, maapvali, patlavale }; // earned: 2275.00, 625.00, 812.50
};
const workSnapshot = () => JSON.stringify([[...db.attendance.values()], [...db.maap.values()], [...db.production.values()], [...db.seasons.values()], [...db.labours.values()], db.rates]);

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
  it("needs a login for every payment and balance route", async () => {
    const id = "aaaaaaaaaaaaaaaaaaaaaaaa";
    for (const [method, url] of [
      ["get", "/api/payments"],
      ["post", "/api/payments"],
      ["get", `/api/payments/${id}`],
      ["patch", `/api/payments/${id}`],
      ["delete", `/api/payments/${id}`],
      ["get", "/api/labours/L-001/payments"],
      ["get", "/api/labours/L-001/balance"],
      ["get", "/api/balances"],
    ]) {
      expect((await send(method, url, null, method === "get" ? undefined : {})).status, `${method} ${url}`).toBe(401);
    }
  });

  it("lets a non-owner read but not create, correct or void", async () => {
    const w = await makeLabour("BIGARI");
    const p = await paid(w);
    expect((await send("get", "/api/payments", manager.cookie)).status).toBe(200);
    expect((await send("get", `/api/labours/${w.id}/balance`, manager.cookie)).status).toBe(200);
    expect((await send("get", "/api/balances", manager.cookie)).status).toBe(200);
    expect((await send("post", "/api/payments", manager.cookie, { recipientId: w.id, type: "SALARY_PAYMENT", amount: 5, date: today })).status).toBe(403);
    expect((await send("patch", `/api/payments/${p.id}`, manager.cookie, { amount: 5, reason: "Fix it" })).status).toBe(403);
    expect((await send("delete", `/api/payments/${p.id}`, manager.cookie, { reason: "Wrong person" })).status).toBe(403);
    expect(liveRows()).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
describe("creating payments: recipients and types", () => {
  it("pays an individual worker and a Patlavale team, each linked to the right recipient", async () => {
    const [bigari, maapvali, team] = [await makeLabour("BIGARI"), await makeLabour("MAAPVALI"), await makeLabour("PATLAVALE")];
    const a = await paid(bigari, { amount: 500 });
    const b = await paid(maapvali, { amount: 600 });
    const c = await paid(team, { amount: 700 });
    expect(a).toMatchObject({ recipientId: bigari.id, labourId: bigari.id, recipientType: "WORKER", amount: 500 });
    expect(b).toMatchObject({ recipientId: maapvali.id, recipientType: "WORKER", amount: 600 });
    expect(c).toMatchObject({ recipientId: team.id, recipientType: "TEAM", amount: 700 });
    for (const [labour, amount] of [[bigari, 500], [maapvali, 600], [team, 700]]) {
      const history = (await asOwner("get", `/api/labours/${labour.id}/payments`)).body;
      expect(history.data.map((p) => p.amount)).toEqual([amount]);
    }
  });

  it("Bayana is stored as BOOKING_ADVANCE and flagged as an advance; salary and other are not", async () => {
    const w = await makeLabour("BIGARI");
    const bayana = await paid(w, { type: "BOOKING_ADVANCE", amount: 3000 });
    const salary = await paid(w, { type: "SALARY_PAYMENT", amount: 1000, date: daysAgo(1) });
    const other = await paid(w, { type: "OTHER", amount: 200, note: "Tea money" });
    expect([bayana.type, bayana.isAdvance]).toEqual(["BOOKING_ADVANCE", true]);
    expect([salary.type, salary.isAdvance]).toEqual(["SALARY_PAYMENT", false]);
    expect([other.type, other.isAdvance]).toEqual(["OTHER", false]);
    expect((await asOwner("get", `/api/payments?type=BOOKING_ADVANCE`)).body.data.map((p) => p.id)).toEqual([bayana.id]);
  });

  it("stores amount (exact paise), date, method, reference and note", async () => {
    const w = await makeLabour("MAAPVALI");
    const p = await paid(w, { amount: 1250.5, method: "UPI", reference: "UTR 123456", note: "Diwali week" });
    expect(p).toMatchObject({ amount: 1250.5, date: today, method: "UPI", reference: "UTR 123456", note: "Diwali week", revision: 1, isDeleted: false });
    expect([...db.payments.values()][0].amountPaise).toBe(125050);
    expect([...db.payments.values()][0].createdBy).toBe(owner.user._id);
  });

  it("defaults the method to CASH and the note and reference to empty", async () => {
    const w = await makeLabour("BIGARI");
    expect(await paid(w)).toMatchObject({ method: "CASH", note: "", reference: "" });
  });

  it("rejects an unknown or malformed recipient", async () => {
    const unknown = await pay({ id: "L-404" });
    expect(unknown.status).toBe(400);
    expect(unknown.body.errors[0].field).toBe("recipientId");
    expect((await pay({ id: "nobody" })).status).toBe(400);
    expect(db.payments.size).toBe(0);
  });

  it("rejects bad amounts: zero, negative, text, too many decimals, huge", async () => {
    const w = await makeLabour("BIGARI");
    for (const amount of [0, -5, "500", 10.123, 10000001, null, NaN]) expect((await pay(w, { amount })).status, String(amount)).toBe(400);
    expect(db.payments.size).toBe(0);
  });

  it("rejects an unknown type or method, bad dates and unexpected fields", async () => {
    const w = await makeLabour("BIGARI");
    for (const extra of [{ type: "LOAN" }, { method: "CHEQUE" }, { date: "2026-02-30" }, { date: "yesterday" }, { recipientType: "TEAM" }, { balance: 5 }, { amountPaise: 100 }, { isDeleted: true }]) {
      expect((await pay(w, extra)).status, JSON.stringify(extra)).toBe(400);
    }
    expect(db.payments.size).toBe(0);
  });

  it("needs a note for Other payments", async () => {
    const w = await makeLabour("BIGARI");
    expect((await pay(w, { type: "OTHER" })).status).toBe(400);
    expect((await pay(w, { type: "OTHER", note: "   " })).status).toBe(400);
    expect((await pay(w, { type: "OTHER", note: "Medicine" })).status).toBe(201);
  });

  it("rejects a future date, using the Indian day", async () => {
    const w = await makeLabour("BIGARI");
    expect((await pay(w, { date: addDays(today, 1) })).status).toBe(400);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-02T18:15:00Z")); // 23:45 on 2 Nov in India
    owner = addUser("OWNER");
    const early = await makeLabour("BIGARI", { joiningDate: "2026-10-01" });
    expect((await pay(early, { date: "2026-11-03" })).status).toBe(400);
    expect((await pay(early, { date: "2026-11-02" })).status).toBe(201);
    vi.setSystemTime(new Date("2026-11-02T18:45:00Z")); // 00:15 on 3 Nov in India
    owner = addUser("OWNER");
    expect((await pay(early, { date: "2026-11-03", amount: 777 })).status).toBe(201);
  });

  it("only a Bayana may be dated before the joining date", async () => {
    const w = await makeLabour("BIGARI", { joiningDate: daysAgo(5) });
    expect((await pay(w, { type: "BOOKING_ADVANCE", date: daysAgo(10) })).status).toBe(201);
    const bad = await pay(w, { type: "SALARY_PAYMENT", date: daysAgo(10) });
    expect(bad.status).toBe(400);
    expect(bad.body.errors[0].field).toBe("date");
  });

  it("an inactive recipient can still be paid (final settlement)", async () => {
    const w = await makeLabour("BIGARI");
    await asOwner("patch", `/api/labours/${w.id}`, { status: "INACTIVE" });
    expect((await pay(w)).status).toBe(201);
  });
});

// ---------------------------------------------------------------------------
describe("duplicate submissions", () => {
  it("a retried requestId returns the first payment and never creates a second", async () => {
    const w = await makeLabour("BIGARI");
    const body = { recipientId: w.id, type: "BOOKING_ADVANCE", amount: 3000, date: today, requestId: "pay-req-0001" };
    const first = await asOwner("post", "/api/payments", body);
    const retry = await asOwner("post", "/api/payments", body);
    const again = await asOwner("post", "/api/payments", body);
    expect([first.status, retry.status, again.status]).toEqual([201, 200, 200]);
    expect([first.body.meta.replayed, retry.body.meta.replayed]).toEqual([false, true]);
    expect(retry.body.data.id).toBe(first.body.data.id);
    expect(db.payments.size).toBe(1);
    expect((await balanceOf(w)).bayana).toBe(3000);
  });

  it("the same requestId with a different payment is refused", async () => {
    const [a, b] = [await makeLabour("BIGARI"), await makeLabour("BIGARI")];
    await asOwner("post", "/api/payments", { recipientId: a.id, type: "SALARY_PAYMENT", amount: 500, date: today, requestId: "pay-req-0002" });
    for (const change of [{ recipientId: b.id }, { amount: 501 }, { type: "BOOKING_ADVANCE" }, { date: daysAgo(1) }]) {
      const res = await asOwner("post", "/api/payments", { recipientId: a.id, type: "SALARY_PAYMENT", amount: 500, date: today, requestId: "pay-req-0002", ...change });
      expect(res.status, JSON.stringify(change)).toBe(409);
      expect(res.body.errors[0].field).toBe("requestId");
    }
    expect(db.payments.size).toBe(1);
  });

  it("two copies of one request that race get the winner's payment, not an error or a second row", async () => {
    const w = await makeLabour("BIGARI");
    const body = { recipientId: w.id, type: "SALARY_PAYMENT", amount: 800, date: today, requestId: "pay-req-0003" };
    db.beforePaymentCreate = () => {
      db.beforePaymentCreate = null;
      db.payments.set("winner", { _id: "winner", recipientId: w.id, recipientType: "WORKER", type: "SALARY_PAYMENT", amountPaise: 80000, date: today, method: "CASH", requestId: "pay-req-0003", revision: 1, isDeleted: false, history: [], createdAt: new Date(), updatedAt: new Date() });
    };
    const res = await asOwner("post", "/api/payments", body);
    expect(res.status).toBe(200);
    expect(res.body.meta.replayed).toBe(true);
    expect(res.body.data.id).toBe("winner");
    expect(db.payments.size).toBe(1);
  });

  it("rejects a malformed requestId", async () => {
    const w = await makeLabour("BIGARI");
    for (const requestId of ["short", "has spaces in it", "x".repeat(65)]) expect((await pay(w, { requestId })).status, requestId).toBe(400);
  });

  it("with no requestId, an identical payment seconds later is refused as a double submit", async () => {
    const w = await makeLabour("BIGARI");
    await paid(w, { amount: 500 });
    const dup = await pay(w, { amount: 500 });
    expect(dup.status).toBe(409);
    expect(db.payments.size).toBe(1);
    expect((await pay(w, { amount: 501 })).status).toBe(201); // a different amount is a different payment
    expect((await pay(w, { amount: 500, type: "BOOKING_ADVANCE" })).status).toBe(201); // so is a different type
    expect((await pay(w, { amount: 500, date: daysAgo(1) })).status).toBe(201); // and a different date
  });

  it("the same payment again after the window is allowed (a genuine second payment)", async () => {
    const w = await makeLabour("BIGARI");
    await paid(w, { amount: 500 });
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(Date.now() + 31000));
    owner = addUser("OWNER");
    expect((await pay(w, { amount: 500 })).status).toBe(201);
    expect(db.payments.size).toBe(2);
  });

  it("a voided payment does not block entering the same payment again", async () => {
    const w = await makeLabour("BIGARI");
    const p = await paid(w, { amount: 500 });
    await asOwner("delete", `/api/payments/${p.id}`, { reason: "Wrong person" });
    expect((await pay(w, { amount: 500 })).status).toBe(201);
  });
});

// ---------------------------------------------------------------------------
describe("correcting a payment", () => {
  it("changes the fields, keeps the recipient and records the old values with who, when and why", async () => {
    const w = await makeLabour("BIGARI");
    const p = await paid(w, { amount: 1000, method: "CASH", note: "first" });
    const res = await asOwner("patch", `/api/payments/${p.id}`, { amount: 1500, type: "BOOKING_ADVANCE", method: "UPI", reference: "UTR9", note: "second", date: daysAgo(1), reason: "Typed the wrong amount" });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ amount: 1500, type: "BOOKING_ADVANCE", isAdvance: true, method: "UPI", reference: "UTR9", note: "second", date: daysAgo(1), recipientId: w.id, revision: 2, corrected: true });
    expect(res.body.data.revisions).toHaveLength(1);
    expect(res.body.data.revisions[0]).toMatchObject({ by: "Ramesh Patel", reason: "Typed the wrong amount", before: { amount: 1000, type: "SALARY_PAYMENT", method: "CASH", note: "first", date: today } });
    expect(db.payments.size).toBe(1);
  });

  it("keeps every earlier version across several corrections", async () => {
    const w = await makeLabour("BIGARI");
    const p = await paid(w, { amount: 1000 });
    await asOwner("patch", `/api/payments/${p.id}`, { amount: 1100, reason: "First fix" });
    await asOwner("patch", `/api/payments/${p.id}`, { amount: 1200, reason: "Second fix" });
    const detail = (await asOwner("get", `/api/payments/${p.id}`)).body.data;
    expect(detail.revisions.map((r) => [r.before.amount, r.reason])).toEqual([[1000, "First fix"], [1100, "Second fix"]]);
    expect(detail.amount).toBe(1200);
  });

  it("needs a reason and at least one field, and never accepts a new recipient", async () => {
    const [w, other] = [await makeLabour("BIGARI"), await makeLabour("BIGARI")];
    const p = await paid(w);
    for (const body of [{ amount: 5 }, { reason: "Fix it" }, { amount: 5, reason: "x" }, { amount: 5, reason: "Fix it", recipientId: other.id }, { amount: 5, reason: "Fix it", recipientType: "TEAM" }, { amount: 0, reason: "Fix it" }]) {
      expect((await asOwner("patch", `/api/payments/${p.id}`, body)).status, JSON.stringify(body)).toBe(400);
    }
    expect(liveRows()[0]).toMatchObject({ amountPaise: 100000, recipientId: w.id, revision: 1 });
  });

  it("a correction that changes nothing is not a new revision", async () => {
    const w = await makeLabour("BIGARI");
    const p = await paid(w, { amount: 1000 });
    expect((await asOwner("patch", `/api/payments/${p.id}`, { amount: 1000, reason: "Same again" })).body.data.revision).toBe(1);
  });

  it("applies the same rules as creating: future date, joining date, note for Other", async () => {
    const w = await makeLabour("BIGARI", { joiningDate: daysAgo(5) });
    const p = await paid(w, { amount: 1000 });
    expect((await asOwner("patch", `/api/payments/${p.id}`, { date: addDays(today, 1), reason: "Wrong day" })).status).toBe(400);
    expect((await asOwner("patch", `/api/payments/${p.id}`, { date: daysAgo(10), reason: "Wrong day" })).status).toBe(400);
    expect((await asOwner("patch", `/api/payments/${p.id}`, { type: "OTHER", reason: "Wrong type" })).status).toBe(400);
    expect((await asOwner("patch", `/api/payments/${p.id}`, { type: "BOOKING_ADVANCE", date: daysAgo(10), reason: "It was Bayana" })).status).toBe(200);
  });

  it("cannot correct a voided payment; unknown and malformed ids are handled", async () => {
    const w = await makeLabour("BIGARI");
    const p = await paid(w);
    await asOwner("delete", `/api/payments/${p.id}`, { reason: "Wrong person" });
    const blocked = await asOwner("patch", `/api/payments/${p.id}`, { amount: 5, reason: "Fix it" });
    expect([blocked.status, blocked.body.message]).toEqual([409, "A voided payment cannot be corrected"]);
    expect((await asOwner("patch", "/api/payments/aaaaaaaaaaaaaaaaaaaaaaaa", { amount: 5, reason: "Fix it" })).status).toBe(404);
    expect((await asOwner("patch", "/api/payments/nope", { amount: 5, reason: "Fix it" })).status).toBe(400);
  });

  it("a change made between our read and our write is a conflict, never a lost update", async () => {
    const w = await makeLabour("BIGARI");
    const p = await paid(w, { amount: 1000 });
    db.beforePaymentUpdate = (filter) => {
      db.beforePaymentUpdate = null;
      const found = [...db.payments.values()].find((r) => r._id === String(filter._id));
      found.revision += 1;
      found.amountPaise = 999900;
    };
    expect((await asOwner("patch", `/api/payments/${p.id}`, { amount: 1200, reason: "Fix it" })).status).toBe(409);
    expect(liveRows()[0].amountPaise).toBe(999900);
  });
});

// ---------------------------------------------------------------------------
describe("voiding a payment (reversal, never erasure)", () => {
  it("keeps the record with who, when and why, and leaves it out of the balance", async () => {
    const w = await makeLabour("BIGARI");
    const p = await paid(w, { amount: 1000 });
    expect((await asOwner("delete", `/api/payments/${p.id}`, {})).status).toBe(400); // reason required
    expect((await asOwner("delete", `/api/payments/${p.id}`, { reason: "x" })).status).toBe(400);
    const res = await asOwner("delete", `/api/payments/${p.id}`, { reason: "Paid the wrong person" });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ isDeleted: true, deletedReason: "Paid the wrong person", deletedBy: "Ramesh Patel", amount: 1000 });
    expect(db.payments.size).toBe(1);
    expect((await balanceOf(w)).totalReceived).toBe(0);
  });

  it("history hides voided payments unless asked, and totals never count them", async () => {
    const w = await makeLabour("BIGARI");
    const keep = await paid(w, { amount: 400 });
    const gone = await paid(w, { amount: 600, date: daysAgo(1) });
    await asOwner("delete", `/api/payments/${gone.id}`, { reason: "Wrong person" });
    const plain = (await asOwner("get", `/api/payments?recipientId=${w.id}`)).body;
    expect(plain.data.map((p) => p.id)).toEqual([keep.id]);
    expect(plain.meta.summary.totalReceived).toBe(400);
    const all = (await asOwner("get", `/api/payments?recipientId=${w.id}&includeDeleted=true`)).body;
    expect(all.data).toHaveLength(2);
    expect(all.meta.summary.totalReceived).toBe(400);
  });

  it("cannot be voided twice, and a voided payment can be entered again as a new one", async () => {
    const w = await makeLabour("BIGARI");
    const p = await paid(w, { amount: 1000 });
    await asOwner("delete", `/api/payments/${p.id}`, { reason: "Wrong person" });
    expect((await asOwner("delete", `/api/payments/${p.id}`, { reason: "Wrong person" })).status).toBe(409);
    const right = await makeLabour("BIGARI");
    await paid(right, { amount: 1000 });
    expect(db.payments.size).toBe(2);
    expect((await balanceOf(right)).totalReceived).toBe(1000);
    expect((await balanceOf(w)).totalReceived).toBe(0);
  });

  it("returns 404 for an unknown payment", async () => {
    expect((await asOwner("delete", "/api/payments/aaaaaaaaaaaaaaaaaaaaaaaa", { reason: "Wrong person" })).status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
describe("payment history", () => {
  const setup = async () => {
    const [a, b] = [await makeLabour("BIGARI"), await makeLabour("PATLAVALE")];
    const p1 = await paid(a, { type: "BOOKING_ADVANCE", amount: 3000, date: daysAgo(30) });
    const p2 = await paid(a, { amount: 1000, date: daysAgo(10) });
    const p3 = await paid(a, { amount: 1200, date: daysAgo(2) });
    const p4 = await paid(b, { amount: 2000, date: daysAgo(5) });
    return { a, b, p1, p2, p3, p4 };
  };

  it("lists newest first with totals over every match, and pages", async () => {
    const { p1, p2, p3, p4 } = await setup();
    const res = (await asOwner("get", "/api/payments?limit=2")).body;
    expect(res.data.map((p) => p.id)).toEqual([p3.id, p4.id]);
    expect(res.meta).toMatchObject({ page: 1, limit: 2, total: 4 });
    expect(res.meta.summary).toMatchObject({ payments: 4, bayana: 3000, salaryPayments: 4200, otherPayments: 0, totalReceived: 7200 });
    const page2 = (await asOwner("get", "/api/payments?limit=2&page=2")).body;
    expect(page2.data.map((p) => p.id)).toEqual([p2.id, p1.id]);
  });

  it("filters by recipient, type and date range", async () => {
    const { a, b, p2, p3 } = await setup();
    expect((await asOwner("get", `/api/payments?recipientId=${b.id}`)).body.data).toHaveLength(1);
    expect((await asOwner("get", `/api/payments?recipientId=${a.id}&type=SALARY_PAYMENT`)).body.data.map((p) => p.id)).toEqual([p3.id, p2.id]);
    const range = (await asOwner("get", `/api/payments?from=${daysAgo(10)}&to=${daysAgo(2)}`)).body;
    expect(range.data).toHaveLength(3);
    expect(range.meta.summary.totalReceived).toBe(4200);
  });

  it("per-recipient history works for workers and teams, and 404s for an unknown labour", async () => {
    const { a, b } = await setup();
    const hist = (await asOwner("get", `/api/labours/${a.id}/payments`)).body;
    expect(hist.data).toHaveLength(3);
    expect(hist.meta.summary).toMatchObject({ bayana: 3000, salaryPayments: 2200, totalReceived: 5200 });
    expect((await asOwner("get", `/api/labours/${b.id}/payments?type=BOOKING_ADVANCE`)).body.data).toEqual([]);
    expect((await asOwner("get", "/api/labours/L-404/payments")).status).toBe(404);
  });

  it("a corrected amount shows in history and totals, with the old value kept in the trail", async () => {
    const { a, p2 } = await setup();
    await asOwner("patch", `/api/payments/${p2.id}`, { amount: 1500, reason: "Typed the wrong amount" });
    expect((await asOwner("get", `/api/labours/${a.id}/payments`)).body.meta.summary.totalReceived).toBe(5700);
    expect((await asOwner("get", `/api/payments/${p2.id}`)).body.data.revisions[0].before.amount).toBe(1000);
  });

  it("rejects contradictory or unknown query values", async () => {
    for (const q of [`from=${today}&to=${daysAgo(3)}`, "type=LOAN", "recipientId=nope", "x=1", "limit=0", "limit=501"]) {
      expect((await asOwner("get", `/api/payments?${q}`)).status, q).toBe(400);
    }
  });
});

// ---------------------------------------------------------------------------
describe("balances reconcile with earnings and payments", () => {
  it("balance = earned - total received for a Bigari, a Maapvali and a Patlavale team", async () => {
    const { bigari, maapvali, patlavale } = await setupWork();
    expect(await balanceOf(bigari)).toMatchObject({ labourType: "BIGARI", earned: 2275, totalReceived: 0, balance: 2275, work: { workingUnits: 3.5 } });
    expect(await balanceOf(maapvali)).toMatchObject({ earned: 625, balance: 625, work: { maaps: 10 } });
    expect(await balanceOf(patlavale)).toMatchObject({ earned: 812.5, balance: 812.5, work: { maaps: 5, payableBricks: 1250, physicalBricks: 1375 } });

    await paid(bigari, { type: "BOOKING_ADVANCE", amount: 1000 });
    await paid(bigari, { amount: 500 });
    await paid(maapvali, { amount: 300 });
    await paid(patlavale, { type: "BOOKING_ADVANCE", amount: 200 });
    await paid(patlavale, { amount: 100 });

    expect(await balanceOf(bigari)).toMatchObject({ earned: 2275, bayana: 1000, salaryPayments: 500, totalReceived: 1500, balance: 775, overpaid: false });
    expect(await balanceOf(maapvali)).toMatchObject({ totalReceived: 300, balance: 325 });
    expect(await balanceOf(patlavale)).toMatchObject({ bayana: 200, salaryPayments: 100, totalReceived: 300, balance: 512.5 });
  });

  it("Bayana is counted once: it is part of total received, not subtracted again", async () => {
    const { bigari } = await setupWork();
    await paid(bigari, { type: "BOOKING_ADVANCE", amount: 1000 });
    const b = await balanceOf(bigari);
    expect(b.totalReceived).toBe(1000);
    expect(b.balance).toBe(1275); // 2275 - 1000, not 2275 - 2000
  });

  it("shows a negative balance (overpaid) when more was paid than earned", async () => {
    const { maapvali } = await setupWork();
    await paid(maapvali, { type: "BOOKING_ADVANCE", amount: 1000 });
    expect(await balanceOf(maapvali)).toMatchObject({ earned: 625, balance: -375, overpaid: true });
  });

  it("a Bayana paid before any work exists is an advance against future earnings", async () => {
    const w = await makeLabour("PATLAVALE");
    await paid(w, { type: "BOOKING_ADVANCE", amount: 5000 });
    expect(await balanceOf(w)).toMatchObject({ earned: 0, bayana: 5000, balance: -5000, overpaid: true });
  });

  it("voiding and correcting move the balance by exactly the right amount", async () => {
    const { bigari } = await setupWork();
    const p = await paid(bigari, { amount: 1000 });
    expect((await balanceOf(bigari)).balance).toBe(1275);
    await asOwner("patch", `/api/payments/${p.id}`, { amount: 1500, reason: "Typed the wrong amount" });
    expect((await balanceOf(bigari)).balance).toBe(775);
    await asOwner("delete", `/api/payments/${p.id}`, { reason: "Wrong person" });
    expect((await balanceOf(bigari)).balance).toBe(2275);
  });

  it("new work moves earned and balance, and leaves what was paid alone", async () => {
    const { maapvali } = await setupWork();
    await paid(maapvali, { amount: 200 });
    await asOwner("put", `/api/maap-entries/day/${today}`, { rows: [{ labourId: maapvali.id, maaps: 20 }] });
    expect(await balanceOf(maapvali)).toMatchObject({ earned: 1250, totalReceived: 200, balance: 1050 });
  });

  it("lists everyone, filters by type, and the grand totals are the sum of the lines", async () => {
    const { bigari, maapvali, patlavale } = await setupWork();
    await paid(bigari, { amount: 500 });
    await paid(patlavale, { amount: 100 });
    const all = (await asOwner("get", "/api/balances")).body;
    expect(all.data.map((l) => l.labourId)).toEqual([bigari.id, maapvali.id, patlavale.id].sort());
    expect(all.meta.totals).toEqual({ labours: 3, earned: 3712.5, totalReceived: 600, balance: 3112.5 });
    expect(all.data.reduce((t, l) => t + l.balance, 0)).toBe(all.meta.totals.balance);
    expect((await asOwner("get", "/api/balances?labourType=PATLAVALE")).body.data).toHaveLength(1);
    expect((await asOwner("get", "/api/balances?labourType=TRUCK")).status).toBe(400);
    expect((await asOwner("get", "/api/labours/L-404/balance")).status).toBe(404);
  });

  it("totals are exact, with no floating-point drift", async () => {
    const w = await makeLabour("BIGARI");
    for (const [i, amount] of [0.1, 0.2, 0.3, 10.01, 10.02].entries()) await paid(w, { amount, date: daysAgo(i + 1) });
    expect((await balanceOf(w)).totalReceived).toBe(20.63);
    expect(summarizePayments([{ type: "SALARY_PAYMENT", amountPaise: 10 }, { type: "SALARY_PAYMENT", amountPaise: 20 }]).totalReceivedPaise).toBe(30);
  });

  it("the calculation itself ignores voided payments", () => {
    const rows = [{ type: "SALARY_PAYMENT", amountPaise: 500 }, { type: "BOOKING_ADVANCE", amountPaise: 700, isDeleted: true }];
    expect(summarizePayments(rows)).toMatchObject({ payments: 1, bayanaPaise: 0, totalReceivedPaise: 500 });
  });

  it("the accounting policy is one place: every type counts as received for now", () => {
    expect(ACCOUNTING_POLICY).toEqual({ bayanaCountsAsReceived: true, otherCountsAsReceived: true });
    for (const type of ["BOOKING_ADVANCE", "SALARY_PAYMENT", "OTHER"]) expect(countsAsReceived(type)).toBe(true);
    const rows = [{ type: "BOOKING_ADVANCE", amountPaise: 100 }, { type: "OTHER", amountPaise: 50 }, { type: "SALARY_PAYMENT", amountPaise: 25 }];
    const strict = summarizePayments(rows, { bayanaCountsAsReceived: true, otherCountsAsReceived: false });
    expect(strict).toMatchObject({ totalReceivedPaise: 125, notCountedPaise: 50 });
    expect(balancePaise(1000, strict.totalReceivedPaise)).toBe(875);
  });
});

// ---------------------------------------------------------------------------
describe("payments never change work, production or earnings", () => {
  it("creating, correcting and voiding leave attendance, maap entries, production, seasons and labours untouched", async () => {
    const { bigari, maapvali, patlavale } = await setupWork();
    const before = workSnapshot();
    for (const w of [bigari, maapvali, patlavale]) {
      const p = await paid(w, { type: "BOOKING_ADVANCE", amount: 700 });
      await paid(w, { amount: 300, date: daysAgo(1) });
      await asOwner("patch", `/api/payments/${p.id}`, { amount: 900, reason: "Typed the wrong amount" });
      await asOwner("delete", `/api/payments/${p.id}`, { reason: "Wrong person" });
    }
    expect(workSnapshot()).toBe(before);
  });

  it("season production totals do not change when a payment is made, even one larger than the earnings", async () => {
    const { season, patlavale } = await setupWork();
    const totals = async () => (await asOwner("get", `/api/seasons/${season.id}/production`)).body.data;
    const before = await totals();
    expect(before.summary).toMatchObject({ maaps: 5, payableBricks: 1250, earnings: 812.5 });
    await paid(patlavale, { type: "BOOKING_ADVANCE", amount: 5000 });
    await paid(patlavale, { amount: 812.5 });
    expect(await totals()).toEqual(before);
    expect((await balanceOf(patlavale)).work).toMatchObject({ maaps: 5, payableBricks: 1250 });
  });

  it("production keeps accumulating after payments, and the payments stay untouched by it", async () => {
    const { season, patlavale } = await setupWork();
    await paid(patlavale, { amount: 812.5 });
    await asOwner("put", `/api/production-entries/day/${daysAgo(1)}`, { rows: [{ teamId: patlavale.id, maaps: 3 }], reason: "Late entry" });
    const totals = (await asOwner("get", `/api/seasons/${season.id}/production`)).body.data.summary;
    expect(totals).toMatchObject({ maaps: 8, payableBricks: 2000 });
    expect(await balanceOf(patlavale)).toMatchObject({ earned: 1300, totalReceived: 812.5, balance: 487.5 });
    expect(liveRows()).toHaveLength(1);
  });

  it("no payment module imports or touches work records", () => {
    for (const file of ["services/payment.service.js", "services/paymentCalculations.js", "controllers/payment.controller.js", "routes/payment.routes.js", "models/Payment.js", "validators/payment.validators.js", "constants/payments.js"]) {
      const imports = readFileSync(new URL(`../${file}`, import.meta.url), "utf8").split("\n").filter((line) => /^\s*import\b/.test(line)).join("\n").toLowerCase();
      for (const word of ["attendance", "maapentry", "productionentry", "season", "attendance.service", "balance.service"]) {
        // the controller may use the balance service for reads; nothing else may
        if (word === "balance.service" && file === "controllers/payment.controller.js") continue;
        expect(imports, `${file} ${word}`).not.toContain(word);
      }
    }
  });

  it("the balance service only reads: it never calls a write on any collection", () => {
    const code = readFileSync(new URL("../services/balance.service.js", import.meta.url), "utf8");
    for (const write of [".create(", ".updateOne(", ".updateMany(", ".deleteOne(", ".deleteMany(", ".save(", ".insertMany(", ".findOneAndUpdate("]) expect(code, write).not.toContain(write);
  });

  it("the stored payment holds no work or balance fields", async () => {
    const w = await makeLabour("BIGARI");
    await paid(w);
    for (const field of ["earned", "balance", "units", "maaps", "numberOfMaaps", "payableBricks", "seasonId"]) expect([...db.payments.values()][0]).not.toHaveProperty(field);
  });
});

// ---------------------------------------------------------------------------
describe("model", () => {
  const valid = { recipientId: "L-001", recipientType: "WORKER", type: "SALARY_PAYMENT", amountPaise: 100000, date: "2026-11-01" };
  const errorsOf = (data) => new RealPayment(data).validateSync()?.errors ?? {};

  it("accepts a valid payment with sensible defaults", () => {
    const doc = new RealPayment(valid);
    expect(doc.validateSync()).toBeUndefined();
    expect(doc).toMatchObject({ method: "CASH", note: "", reference: "", requestId: null, revision: 1, isDeleted: false });
  });

  it("rejects bad amounts, types, methods, recipients and dates, and drops unknown fields", () => {
    for (const amountPaise of [0, -1, 10.5]) expect(errorsOf({ ...valid, amountPaise }).amountPaise, String(amountPaise)).toBeDefined();
    expect(errorsOf({ ...valid, type: "LOAN" }).type).toBeDefined();
    expect(errorsOf({ ...valid, method: "CHEQUE" }).method).toBeDefined();
    expect(errorsOf({ ...valid, recipientType: "BOSS" }).recipientType).toBeDefined();
    expect(errorsOf({ ...valid, recipientId: "X-1" }).recipientId).toBeDefined();
    expect(errorsOf({ ...valid, date: "2026-02-30" }).date).toBeDefined();
    expect(errorsOf({})).toHaveProperty("recipientId");
    expect(new RealPayment({ ...valid, balance: 500 }).get("balance")).toBeUndefined();
  });

  it("indexes requestId as unique for string keys only", () => {
    const index = RealPayment.schema.indexes().find(([fields]) => fields.requestId === 1);
    expect(index[1]).toMatchObject({ unique: true, partialFilterExpression: { requestId: { $type: "string" } } });
  });
});
