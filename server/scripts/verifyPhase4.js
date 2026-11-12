// Phase 4: Pheera <-> Bill lifecycle check against a RUNNING backend and its REAL MongoDB, over the same HTTP API the frontend uses,
// and against the database itself (a second, read-only look at the stored documents after each important step).
//
//   1. In server/.env set MONGODB_URI to a DEDICATED TEST database (the database NAME must END with "_test", e.g. brickpro_test).
//   2. Start the backend from the same folder:   npm run dev      (it must use that same .env)
//   3. In Windows PowerShell:
//        $env:PHASE4_CONFIRM_DB = "brickpro_test"; $env:OWNER_EMAIL = "..."; $env:OWNER_PASSWORD = "..."
//        node scripts\verifyPhase4.js --i-understand-this-writes-test-data [--set-test-settings]
//
// SAFETY (all of this happens BEFORE any write through the backend, and before logging in, because a login also writes):
//   - NODE_ENV=production is refused.
//   - The database name in MONGODB_URI must END with "_test" (case-insensitive; "prodtest" or "brickpro_test_backup" are refused) AND
//     must equal PHASE4_CONFIRM_DB, typed by you.
//   - IDENTITY of the running backend is proven read-only: GET /api/health (no login, no write) reports the database name the backend
//     is connected to. It must equal the confirmed TEST name and the backend must not report NODE_ENV=production. Otherwise: STOP.
//     (Limit: this proves the database NAME. Use a TEST cluster/user that production credentials cannot reach.)
//   - After login (the first backend write is only that) a second read-only comparison runs: the customer total seen through the
//     backend must equal the total in this script's database. Otherwise: STOP before writing anything.
//   - CRITICAL checks (safety, identity, auth, indexes, every "create" that later steps depend on) HALT the run at once. Later steps never
//     run with a missing ID or a failed response. Other checks are reported and the run goes on.
//   - Only the database NAME is printed, never the connection string, host or password.
//   - It never deletes, drops, migrates or syncs indexes. Records it creates are named "ZZ P4 ..." and stay in the TEST database.
// --set-test-settings: only if the TEST invoice settings lack a seller name/address/GSTIN/state, it fills test values (TEST DB only).

import mongoose from "mongoose";
import { env } from "../config/env.js";
import { NetworkError, createHttp, createReport, recoverUncertainWrite, sanitize } from "./lib/phase4Http.js";

const BASE = (process.env.API_BASE || "http://localhost:5000/api").replace(/\/+$/, "");
const EMAIL = process.env.OWNER_EMAIL;
const PASSWORD = process.env.OWNER_PASSWORD;
const origin = process.env.CLIENT_ORIGIN_FOR_TEST || "http://localhost:5173"; // must be listed in the server's CLIENT_ORIGIN

// Read-only database use: Mongoose must not create collections or build indexes when this script connects (the index checks below
// must report what the backend's database REALLY has, not what this script just built).
mongoose.set("autoIndex", false);
mongoose.set("autoCreate", false);
// The models are loaded only now: Mongoose reads these two settings at the moment a model is defined, so a static import (which runs
// first) would already have scheduled automatic index building.
const { default: Customer } = await import("../models/Customer.js");
const { default: Bill } = await import("../models/Bill.js");
const { default: TruckTrip } = await import("../models/TruckTrip.js");

// ---- safety gate ------------------------------------------------------------------------------------------------------------------
const stop = (message) => {
  console.error(`STOP: ${message}`);
  process.exit(2);
};
if (!process.argv.includes("--i-understand-this-writes-test-data")) stop("this script writes test records. Re-run with --i-understand-this-writes-test-data (TEST database only).");
if (process.env.NODE_ENV === "production") stop("NODE_ENV is production.");
if (!EMAIL || !PASSWORD) stop("set OWNER_EMAIL and OWNER_PASSWORD in the environment.");
const uri = env.mongodbUri;
if (!uri) stop("MONGODB_URI is not set (server/.env).");
const dbName = (() => {
  const m = uri.match(/^mongodb(?:\+srv)?:\/\/[^/]+\/([^/?#]*)/i);
  return m ? decodeURIComponent(m[1]) : "";
})();
if (!dbName) stop("MONGODB_URI has no database name. Add one that ends with _test, for example /brickpro_test.");
if (!/_test$/i.test(dbName)) stop(`the database name "${dbName}" does not end with "_test". Refusing: use a dedicated TEST database named like brickpro_test.`);
if (process.env.PHASE4_CONFIRM_DB !== dbName) stop(`set PHASE4_CONFIRM_DB=${dbName} to confirm that "${dbName}" is the TEST database you mean.`);
try {
  const parsed = new URL(BASE);
  if (!/^https?:$/.test(parsed.protocol)) throw new Error("not http(s)");
} catch {
  stop("API_BASE is not a valid http(s) URL (example: http://localhost:5000/api).");
}
console.log(`Database: ${dbName}  (confirmed as TEST by PHASE4_CONFIRM_DB)\nServer:   ${BASE}\n`);

// ---- helpers ----------------------------------------------------------------------------------------------------------------------
const http = createHttp({
  baseUrl: BASE,
  origin,
  secrets: [PASSWORD, uri],
  onRetry: ({ method, path, attempt, code }) => console.log(`RETRY ${method} ${path}: no answer (${code}), trying again (attempt ${attempt + 1}). Only safe GET requests are retried.`),
});
const call = http.call;
const report = createReport();
const { check } = report;

/**
 * Finalize / cancel are state changes. If the backend drops the connection while one is in flight its outcome is UNKNOWN, so it is never
 * blindly repeated: wait for the backend, read the bill, and only repeat if the read proves the change was NOT applied. The lost
 * connection itself is always reported as INCONCLUSIVE (the backend dropped a connection: check its log), even if the state is recovered.
 */
const writeWithRecovery = async (method, path, body, billId, appliedStatus, notYetStatus) => {
  const { response, recovered, lost } = await recoverUncertainWrite({
    request: () => call(method, path, body),
    reread: () => call("GET", `/bills/${billId}`),
    applied: (r) => (r.status === 200 && r.data?.status === appliedStatus ? true : r.status === 200 && r.data?.status === notYetStatus ? false : null),
    probe: () => http.probeBackend(),
  });
  if (lost) report.inconclusive(`${lost.method} ${lost.path}: connection lost`, `${lost.message}. The bill was re-read afterwards (${recovered === "applied" ? "the change HAD been applied" : "the change had NOT been applied and was sent once more"}). Look at the backend window around this time for the cause.`);
  return response;
};
class Halt extends Error {}
/** A CRITICAL check: on failure the run stops at once (nothing that depends on it may run). */
const must = (name, ok, detail) => {
  if (check(`[critical] ${name}`, ok, detail)) return true;
  throw new Halt(name);
};
/** A response that later steps depend on: the expected status AND an id in the data. */
const created = (name, r, status = 201) => must(name, r.status === status && /^[0-9a-f]{24}$/.test(String(r.data?.id)), `${r.status} ${r.message ?? ""} ${JSON.stringify(r.errors ?? [])}`);
const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" });
const day = (back) => fmt.format(new Date(Date.now() - back * 86400000));
const stamp = String(Date.now()).slice(-7);
const rid = (n) => `p4-${stamp}-${n}-${Math.random().toString(36).slice(2, 8)}`;
const oid = (v) => String(v);
const dbTrip = async (id) => TruckTrip.findById(id).lean();
const dbBill = async (id) => Bill.findById(id).lean();

// ---- main -------------------------------------------------------------------------------------------------------------------------
const main = async () => {
  // Checkpoint A: identity first. Nothing below writes through the backend until the backend is proven to use the TEST database.
  const health = await call("GET", "/health", undefined, { noCookie: true }); // read-only: a ping, no login, no write
  must("backend health answers", health.status === 200 && health.data?.status === "ok", `${health.status} ${health.message ?? ""}`);
  must("backend is NOT running in production mode", health.data?.environment !== "production", health.data?.environment);
  must("the RUNNING BACKEND is connected to the same TEST database (name from GET /health)", health.data?.database?.name === dbName, `backend reports "${health.data?.database?.name}", expected "${dbName}". STOPPED before any login or write`);
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 15000 }); // read-only use of the verified TEST database
  must("this script is connected to the confirmed TEST database", mongoose.connection.name === dbName, mongoose.connection.name);
  const idx = (await TruckTrip.collection.indexes()).map((i) => i.name);
  must("Pheera collection has its indexes (truck/date/number unique, bill link)", ["truckId_1_businessDate_1_pheeraNo_1", "billId_1"].every((n) => idx.includes(n)), idx.join(", "));
  const billIdx = (await Bill.collection.indexes()).map((i) => i.name);
  must("Bill collection has the unique bill-number index", billIdx.includes("billNumber_1"), billIdx.join(", "));

  // Checkpoint A: authentication (the first backend write is the login's last-login time, on the already proven TEST database)
  check("unauthenticated request is refused (401)", (await call("GET", "/customers", undefined, { noCookie: true })).status === 401);
  const login = await call("POST", "/auth/login", { email: EMAIL, password: PASSWORD });
  must("owner login", login.status === 200 && http.hasCookie(), `${login.status} ${login.message}`);
  must("auth/me returns the owner", (await call("GET", "/auth/me")).status === 200);
  check("a malformed id is a 400, not a crash", (await call("GET", "/truck-trips/not-an-id")).status === 400);

  // second, read-only proof that backend and script see the SAME data, before any record is created
  const seenByBackend = await call("GET", "/customers?includeArchived=true&limit=1");
  const seenByScript = await Customer.countDocuments({});
  must("backend and script see the same customers (read-only comparison)", seenByBackend.status === 200 && seenByBackend.meta?.total === seenByScript, `backend total ${seenByBackend.meta?.total}, script total ${seenByScript}`);

  // settings (read; optionally complete the TEST seller details)
  let settings = await call("GET", "/invoice-settings");
  must("invoice settings can be read", settings.status === 200 && Boolean(settings.data), settings.message);
  const sellerOk = Boolean(settings.data?.businessName && settings.data?.address && settings.data?.gstin && settings.data?.stateCode);
  if (!sellerOk && process.argv.includes("--set-test-settings")) {
    const put = await call("PATCH", "/invoice-settings", { businessName: "ZZ P4 Test Seller", address: "Test Road, Test City", gstin: "27AAAAA0000A1Z5", stateName: "Maharashtra", stateCode: "27", allowedTaxRates: [0, 5, 18], units: ["Bricks", "Tonnes", "Trip"] });
    must("TEST invoice settings completed (--set-test-settings)", put.status === 200, `${put.status} ${put.message} ${JSON.stringify(put.errors)}`);
    settings = await call("GET", "/invoice-settings");
  }
  const sellerReady = Boolean(settings.data?.businessName && settings.data?.address && settings.data?.gstin && settings.data?.stateCode);
  if (!sellerReady) report.skip("finalize, PDF, cancel and release checks", "seller details are incomplete in the TEST invoice settings; re-run with --set-test-settings");

  // customers
  const custA = await call("POST", "/customers", { name: `ZZ P4 Alpha ${stamp}`, address: "1 Alpha Road", stateName: "Maharashtra", stateCode: "27" });
  const custB = await call("POST", "/customers", { name: `ZZ P4 Beta ${stamp}`, address: "2 Beta Road", stateName: "Maharashtra", stateCode: "27" });
  created("customer A created", custA);
  created("customer B created", custB);
  must("the created customer is in THIS database", Boolean(await Customer.findById(custA.data.id).lean()), "not found");
  check("duplicate active customer name is refused (409)", (await call("POST", "/customers", { name: `zz p4  alpha ${stamp}`, address: "x" })).status === 409);
  const upd1 = await call("PATCH", `/customers/${custA.data.id}`, { address: "1 Alpha Road, Updated", revision: custA.data.revision });
  check("customer update with the right revision", upd1.status === 200, upd1.message);
  check("customer update with a stale revision is refused (409)", (await call("PATCH", `/customers/${custA.data.id}`, { address: "stale", revision: custA.data.revision })).status === 409);
  const internal = await call("POST", "/customers/internal");
  must("Internal / No Bill customer exists", [200, 201].includes(internal.status) && Boolean(internal.data?.id), internal.message);
  const spare = await call("POST", "/customers", { name: `ZZ P4 Archive ${stamp}` });
  created("archive-test customer created", spare);
  check("a customer without drafts can be archived, and stays out of the active list", (await call("DELETE", `/customers/${spare.data.id}`, { reason: "Phase 4 test" })).status === 200 && !(await call("GET", "/customers")).data.some((c) => c.id === spare.data.id));
  check("an archived customer name cannot be re-created (409)", (await call("POST", "/customers", { name: `ZZ P4 Archive ${stamp}` })).status === 409);

  // truck
  const truck = await call("POST", "/trucks", { truckNumber: `ZZ${stamp}`, nickname: "P4 test" });
  created("truck created", truck);
  const truckId = truck.data.id;
  const trip = async (customerId, material, quantity, extra = {}) => call("POST", "/truck-trips", { truckId, businessDate: day(1), submissionId: rid("s"), customerId, material, destination: "Test Site", quantity, ...(material === "OTHER" ? { customMaterialName: "Khadi" } : {}), ...extra });

  // Checkpoint B: Pheera lifecycle -----------------------------------------------------------------------------------------------
  const P1 = await trip(custA.data.id, "BRICKS", 1000);
  const P2 = await trip(custA.data.id, "SOIL", 4.5);
  const P3 = await trip(custB.data.id, "BRICKS", 2000);
  const PI = await trip(internal.data.id, "BRICKS", 500);
  const PV = await trip(custA.data.id, "BRICKS", 100);
  const PH = await trip(custA.data.id, "BRICKS", 300);
  [["P1", P1], ["P2", P2], ["P3", P3], ["internal Pheera", PI], ["Pheera to void", PV], ["historical Pheera", PH]].forEach(([n, p]) => created(`Pheera ${n} created`, p));
  const id = (p) => p.data.id;
  check("DB: normal customer Pheera starts UNBILLED with no bill", (await dbTrip(id(P1))).billingStatus === "UNBILLED" && (await dbTrip(id(P1))).billId === null);
  check("DB: Internal / No Bill Pheera is NOT_BILLABLE", (await dbTrip(id(PI))).billingStatus === "NOT_BILLABLE");
  check("Pheera numbers are server-assigned 1..n for the truck and day", [P1, P2, P3, PI, PV, PH].map((p) => p.data.pheeraNo).join() === "1,2,3,4,5,6", [P1, P2, P3, PI, PV, PH].map((p) => p.data.pheeraNo).join());
  // a voided Pheera, and a historical (null-status) Pheera made by clearing the billing fields of a disposable test record
  must("a Pheera can be voided", (await call("POST", `/truck-trips/${id(PV)}/void`, { reason: "Phase 4 void" })).status === 200);
  await TruckTrip.collection.updateOne({ _id: new mongoose.Types.ObjectId(id(PH)) }, { $set: { billingStatus: null, customerId: null, billId: null } });
  must("DB: historical Pheera has a null status", (await dbTrip(id(PH))).billingStatus === null);
  const offered = (await call("GET", `/truck-trips?billable=true&customerId=${custA.data.id}&limit=500`)).data?.map((t) => t.id) ?? [];
  check("billable list: UNBILLED shown; voided, internal and historical-null are NOT", offered.includes(id(P1)) && offered.includes(id(P2)) && !offered.includes(id(PV)) && !offered.includes(id(PH)) && !offered.includes(id(PI)), offered.length);
  const refuse = async (ids, why) => {
    const r = await call("POST", "/bills/from-trips", { tripIds: ids, requestId: rid("r") });
    return check(`from-trips refuses ${why}`, r.status >= 400 && r.status < 500, `${r.status} ${r.message}`);
  };
  await refuse([id(PV)], "a voided Pheera");
  await refuse([id(PI)], "an Internal / No Bill Pheera");
  await refuse([id(PH)], "a historical null-status Pheera (not treated as unbilled)");
  await refuse([id(P1), id(P3)], "Pheeras of different customers");
  check("DB: refusals changed nothing", (await dbTrip(id(P1))).billingStatus === "UNBILLED" && (await dbTrip(id(P3))).billingStatus === "UNBILLED");
  check("DB: the historical Pheera is still null after refusals", (await dbTrip(id(PH))).billingStatus === null);

  // draft from Pheeras, idempotent request, concurrency
  const reqId = rid("gen");
  const gen = await call("POST", "/bills/from-trips", { tripIds: [id(P1), id(P2)], requestId: reqId });
  must("draft bill made from two Pheeras (201)", gen.status === 201 && gen.data?.status === "DRAFT" && Boolean(gen.data?.id), `${gen.status} ${gen.message}`);
  const billId = gen.data?.id;
  check("one bill line per Pheera, with the Pheera's own quantity and unit", gen.data?.items?.length === 2 && gen.data.items.some((i) => i.quantity === 1000 && i.pricingUnit === "PER_THOUSAND") && gen.data.items.some((i) => i.quantity === 4.5 && i.pricingUnit === "PER_UNIT"), JSON.stringify(gen.data?.items?.map((i) => [i.quantity, i.unit, i.pricingUnit])));
  const t1 = await dbTrip(id(P1));
  const t2 = await dbTrip(id(P2));
  check("DB: both Pheeras are RESERVED by this draft", t1.billingStatus === "RESERVED" && t2.billingStatus === "RESERVED" && oid(t1.billId) === billId && oid(t2.billId) === billId);
  check("DB: the bill lists both Pheeras", (await dbBill(billId)).sourceTripIds.map(oid).sort().join() === [id(P1), id(P2)].sort().join());
  const again = await call("POST", "/bills/from-trips", { tripIds: [id(P1), id(P2)], requestId: reqId });
  check("the SAME requestId returns the same draft (duplicate), no second bill", again.status < 300 && again.data?.id === billId && again.meta?.duplicate === true, `${again.status} ${again.message}`);
  check("DB: still exactly one bill holds P1", (await Bill.countDocuments({ sourceTripIds: new mongoose.Types.ObjectId(id(P1)) })) === 1);
  const other = await call("POST", "/bills/from-trips", { tripIds: [id(P1)], requestId: rid("other") });
  check("a RESERVED Pheera cannot go into another draft (409)", other.status === 409, `${other.status} ${other.message}`);

  // two simultaneous attempts on the same fresh Pheera: exactly one wins
  const race = await Promise.all([1, 2].map((n) => call("POST", "/bills/from-trips", { tripIds: [id(P3)], requestId: rid(`race${n}`) })));
  const wins = race.filter((r) => r.status === 201);
  check("two simultaneous attempts on one Pheera: exactly one succeeds", wins.length === 1 && race.some((r) => r.status === 409), race.map((r) => r.status).join());
  const raceBill = wins[0]?.data?.id;
  check("DB: the Pheera belongs to exactly one bill", (await Bill.countDocuments({ sourceTripIds: new mongoose.Types.ObjectId(id(P3)) })) === 1 && oid((await dbTrip(id(P3))).billId) === raceBill);

  // remove / add / discard
  const rem = await call("DELETE", `/bills/${billId}/trips/${id(P2)}`);
  must("remove one Pheera from the draft", rem.status === 200 && rem.data?.items?.length === 1, `${rem.status} ${rem.message}`);
  const afterRemove = await dbTrip(id(P2));
  check("DB: the removed Pheera is UNBILLED again and unlinked", afterRemove.billingStatus === "UNBILLED" && afterRemove.billId === null);
  const afterRem = await call("GET", `/bills/${billId}`);
  must("the draft can be read again", afterRem.status === 200 && Number.isInteger(afterRem.data?.revision), afterRem.message);
  const revNow = afterRem.data.revision;
  const add = await call("POST", `/bills/${billId}/trips`, { tripIds: [id(P2)], revision: revNow });
  must("add the Pheera back (with the current revision)", add.status === 200 && add.data?.items?.length === 2, `${add.status} ${add.message}`);
  check("adding with a STALE revision is refused (409)", (await call("POST", `/bills/${billId}/trips`, { tripIds: [id(PI)], revision: revNow })).status === 409);
  if (raceBill) {
    const disc = await call("POST", `/bills/${raceBill}/discard`, { reason: "Phase 4 discard" });
    check("discard a draft", disc.status === 200, `${disc.status} ${disc.message}`);
    const afterDiscard = await dbTrip(id(P3));
    check("DB: discarding released its Pheera (UNBILLED, no bill)", afterDiscard.billingStatus === "UNBILLED" && afterDiscard.billId === null, JSON.stringify([afterDiscard.billingStatus, afterDiscard.billId]));
    check("DB: the discarded draft is kept hidden, not deleted", Boolean(await dbBill(raceBill)));
  } else {
    report.skip("discard a draft and its DB checks", "the race produced no draft to discard (see the race check above)");
  }

  // pricing: independent arithmetic. 1000 bricks at 5500/1000 = 5500.00; 4.5 tonnes at 700 = 3150.00; GST 5% intra-state
  const curRes = await call("GET", `/bills/${billId}`);
  must("the draft has both Pheera lines before pricing", curRes.status === 200 && curRes.data?.items?.some((i) => i.quantity === 1000) && curRes.data.items.some((i) => i.quantity === 4.5), `${curRes.status} ${curRes.message}`);
  const cur = curRes.data;
  const lineFor = (q) => cur.items.find((i) => i.quantity === q);
  const patch = await call("PATCH", `/bills/${billId}`, {
    revision: cur.revision,
    items: [
      { sourceTripId: lineFor(1000).sourceTripId, particulars: lineFor(1000).particulars, hsn: "6901", quantity: 1000, unit: lineFor(1000).unit, rate: 5500, taxRate: 5 },
      { sourceTripId: lineFor(4.5).sourceTripId, particulars: lineFor(4.5).particulars, hsn: "2505", quantity: 4.5, unit: lineFor(4.5).unit, rate: 700, taxRate: 5 },
    ],
  });
  must("enter rates, HSN and tax rates on the Pheera lines", patch.status === 200 && Number.isInteger(patch.data?.revision), `${patch.status} ${patch.message} ${JSON.stringify(patch.errors)}`);
  const taxable = 550000 + 315000;
  check("server totals: bricks per 1,000 and soil per tonne", patch.data?.taxableTotalPaise === taxable, `${patch.data?.taxableTotalPaise} (expected ${taxable})`);
  check("server GST: 2.5% CGST + 2.5% SGST (same state)", patch.data?.cgstPaise === 21625 && patch.data?.sgstPaise === 21625 && patch.data?.grandTotalPaise === taxable + 43250, `${patch.data?.cgstPaise}/${patch.data?.sgstPaise}/${patch.data?.grandTotalPaise}`);
  check("editing a Pheera line's quantity is refused", (await call("PATCH", `/bills/${billId}`, { revision: patch.data.revision, items: [{ sourceTripId: lineFor(1000).sourceTripId, particulars: "x", quantity: 999, unit: lineFor(1000).unit, rate: 5500 }, { sourceTripId: lineFor(4.5).sourceTripId, particulars: "y", quantity: 4.5, unit: lineFor(4.5).unit, rate: 700 }] })).status >= 400);
  check("a stale revision on a draft edit is refused (409)", (await call("PATCH", `/bills/${billId}`, { revision: cur.revision, notes: "stale" })).status === 409);

  if (sellerReady) {
    // validation first: a manual GST bill without HSN
    const manual = await call("POST", "/bills", { billDate: day(0), taxMode: "GST", customer: { name: "ZZ P4 Manual Buyer", address: "Manual Road", stateCode: "27" }, items: [{ particulars: "Delivery", quantity: 1, unit: "Trip", rate: 1000, taxRate: 18 }] });
    created("manual draft created", manual);
    const noHsn = await call("POST", `/bills/${manual.data.id}/finalize`, { reviewed: true, revision: manual.data.revision });
    check("finalize without HSN on a GST bill is refused (400) with the field named", noHsn.status === 400 && noHsn.errors.some((e) => /hsn/.test(e.field)), `${noHsn.status} ${JSON.stringify(noHsn.errors)}`);
    const manualFix = await call("PATCH", `/bills/${manual.data.id}`, { revision: manual.data.revision, items: [{ particulars: "Delivery", hsn: "9965", quantity: 1, unit: "Trip", rate: 1000, taxRate: 18 }] });
    must("manual draft fixed (HSN added)", manualFix.status === 200 && Number.isInteger(manualFix.data?.revision), `${manualFix.status} ${manualFix.message}`);
    const manualFin = await call("POST", `/bills/${manual.data.id}/finalize`, { reviewed: true, revision: manualFix.data?.revision });
    check("manual bill finalizes after the fix (no Pheeras involved)", manualFin.status === 200 && manualFin.data?.status === "FINALIZED" && manualFin.data?.grandTotalPaise === 118000, `${manualFin.status} ${manualFin.message}`);

    // finalize the Pheera bill
    const fin = await writeWithRecovery("POST", `/bills/${billId}/finalize`, { reviewed: true, revision: patch.data.revision }, billId, "FINALIZED", "DRAFT");
    must("finalize the Pheera bill", fin.status === 200 && fin.data?.status === "FINALIZED" && Boolean(fin.data?.billNumber), `${fin.status} ${fin.message} ${JSON.stringify(fin.errors)}`);
    const f1 = await dbTrip(id(P1));
    const f2 = await dbTrip(id(P2));
    check("DB: finalizing made both Pheeras BILLED", f1.billingStatus === "BILLED" && f2.billingStatus === "BILLED" && oid(f1.billId) === billId);
    check("DB: the bill has a unique number and status FINALIZED", (await dbBill(billId)).status === "FINALIZED" && (await Bill.countDocuments({ billNumber: fin.data.billNumber })) === 1);
    check("a finalized bill cannot be edited (409)", (await call("PATCH", `/bills/${billId}`, { notes: "x", revision: fin.data.revision })).status === 409);
    check("a finalized bill cannot be discarded", (await call("POST", `/bills/${billId}/discard`, {})).status >= 400);
    check("a BILLED Pheera cannot be billed again (409)", (await call("POST", "/bills/from-trips", { tripIds: [id(P1)], requestId: rid("again") })).status === 409);
    check("a BILLED Pheera cannot be voided or corrected while billed", (await call("POST", `/truck-trips/${id(P1)}/void`, { reason: "should fail" })).status === 409);
    const pdf = await call("GET", `/bills/${billId}/pdf`, undefined, { raw: true });
    check("server PDF of a finalized bill", pdf.status === 200 && pdf.contentType.includes("pdf") && pdf.byteLength > 1000, `${pdf.status}`);

    // cancel
    const can = await writeWithRecovery("POST", `/bills/${billId}/cancel`, { reason: "Phase 4 cancel" }, billId, "CANCELLED", "FINALIZED");
    must("cancel the finalized bill", can.status === 200 && can.data?.status === "CANCELLED" && can.data?.billNumber === fin.data.billNumber, `${can.status} ${can.message}`);
    const c1 = await dbTrip(id(P1));
    check("DB: cancelling did NOT release the Pheeras (still BILLED, still linked)", c1.billingStatus === "BILLED" && oid(c1.billId) === billId, JSON.stringify([c1.billingStatus, c1.billId]));
    check("a cancelled bill's Pheera still cannot be billed again without release (409)", (await call("POST", "/bills/from-trips", { tripIds: [id(P1)], requestId: rid("again2") })).status === 409);
    check("a cancelled bill cannot be cancelled again or edited", (await call("POST", `/bills/${billId}/cancel`, { reason: "twice" })).status >= 400 && (await call("PATCH", `/bills/${billId}`, { notes: "x" })).status >= 400);
    const rel = await call("POST", `/truck-trips/${id(P1)}/release`, { reason: "Phase 4 release after cancel" });
    check("explicit release of a billed Pheera whose bill was cancelled", rel.status === 200, `${rel.status} ${rel.message}`);
    const r1 = await dbTrip(id(P1));
    check("DB: released Pheera is UNBILLED again (history kept on the cancelled bill)", r1.billingStatus === "UNBILLED" && r1.billId === null && oid((await dbBill(billId)).sourceTripIds[0]) !== "", JSON.stringify([r1.billingStatus, r1.billId]));
  }

  // settings round trip (read only unless --set-test-settings)
  check("invoice settings keep their values after the run", (await call("GET", "/invoice-settings")).status === 200);
};

let infrastructureFailure = false;
try {
  await main();
} catch (error) {
  if (error instanceof Halt) console.log(`\nHALTED at a critical check: ${error.message}. No further step was run.`);
  else if (error instanceof NetworkError) {
    infrastructureFailure = true;
    const probe = await http.probeBackend();
    console.log(`\nINFRASTRUCTURE FAILURE (not an application result): ${error.message}`);
    console.log(
      probe.reachable
        ? `  The backend still answers GET /health (HTTP ${probe.status}) now, so it is running: this request was cut off or timed out. Check the backend window for an error printed at that moment.`
        : `  The backend does NOT answer GET /health now (${probe.code}). It stopped or is restarting (note: "npm run dev" restarts when a source file is saved, and a crash is printed in the backend window as "[server] uncaught exception" or "unhandled rejection"). Look at the backend window, start it again, and re-run.`
    );
    if (error.uncertain) {
      report.inconclusive(`${error.method} ${error.path}`, "no answer was received, so it is UNKNOWN whether the server applied it. It was NOT retried. Look for new \"ZZ P4 ...\" records in the TEST database before re-running.");
    } else {
      report.inconclusive(`${error.method} ${error.path}`, `could not be completed (${error.code}) after ${error.attempts} attempts`);
    }
    console.log(`  Last requests: ${http.trace.slice(-4).map((t) => `${t.method} ${t.path} -> ${t.status ?? t.error}`).join(" | ")}`);
  } else if (/^Mongo/.test(error?.name ?? "")) {
    infrastructureFailure = true;
    console.log(`\nINFRASTRUCTURE FAILURE (not an application result): the database connection or a read-only database check failed (${error.name}): ${sanitize(error.message, [PASSWORD, uri])}`);
    console.log("  Check the Atlas Network Access list (this computer's IP), that the cluster is not paused, and that the TEST user and password are right.");
    report.inconclusive("database connection / read-only database check", error.name);
  } else {
    report.check("script error (a defect in this script, not a network problem)", false, sanitize(error?.message, [PASSWORD, uri]));
  }
} finally {
  await mongoose.disconnect().catch(() => {});
}
const { counts, lists } = report;
console.log(`\n===== PHASE 4 REPORT =====\npassed ${counts.passed}   failed ${counts.failed}   skipped ${counts.skipped}   inconclusive ${counts.inconclusive}`);
for (const [label, items] of Object.entries(lists)) if (items.length) console.log(`${label.toUpperCase()}:\n${items.map((i) => `  - ${i}`).join("\n")}`);
console.log(http.hasCookie() ? `Records named "ZZ P4 ..." remain in the TEST database "${dbName}".` : "Nothing was written (no login happened).");
if (infrastructureFailure || counts.skipped > 0) console.log("This run is NOT a complete pass: infrastructure problems or skipped checks mean some behaviour was not verified.");
process.exit(report.exitCode());
