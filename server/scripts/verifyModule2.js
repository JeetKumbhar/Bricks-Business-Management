// Module 2 check against a RUNNING server and its REAL MongoDB, over the same HTTP API the frontend uses.
// It creates clearly named test records, saves attendance / Maapvali work / Patlavale production, then reads everything back
// with fresh requests (so the answers come from the database, not from memory) and checks the business rules.
//
//   OWNER_EMAIL=owner@example.com OWNER_PASSWORD='...' node scripts/verifyModule2.js --i-understand-this-writes-test-data
//   (optional) API_BASE=http://localhost:5000/api
//
// USE A DEVELOPMENT / TEST DATABASE. The API has no DELETE for labours, so the test labours stay in the database (they are set
// INACTIVE at the end, named "ZZ M2 TEST ...") and test entries are soft-deleted or left in place. Never run it on live data.
// The password comes from the environment only; it is never printed.

const BASE = (process.env.API_BASE || "http://localhost:5000/api").replace(/\/+$/, "");
const EMAIL = process.env.OWNER_EMAIL;
const PASSWORD = process.env.OWNER_PASSWORD;

if (!process.argv.includes("--i-understand-this-writes-test-data")) {
  console.error("This script writes test records. Re-run with --i-understand-this-writes-test-data, against a DEVELOPMENT database only.");
  process.exit(2);
}
if (!EMAIL || !PASSWORD) {
  console.error("Set OWNER_EMAIL and OWNER_PASSWORD in the environment.");
  process.exit(2);
}

let cookie = "";
const origin = process.env.CLIENT_ORIGIN_FOR_TEST || "http://localhost:5173"; // must be listed in the server's CLIENT_ORIGIN
const call = async (method, path, body) => {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { Accept: "application/json", Origin: origin, ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...(cookie ? { Cookie: cookie } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const set = res.headers.getSetCookie?.() ?? [];
  const token = set.map((c) => c.split(";")[0]).find((c) => c.startsWith("brickpro_token="));
  if (token) cookie = token;
  let json = null;
  try { json = await res.json(); } catch { /* not JSON */ }
  return { status: res.status, json, data: json?.data, meta: json?.meta, message: json?.message };
};

let passed = 0;
let failed = 0;
const check = (name, ok, detail) => {
  if (ok) passed += 1;
  else failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `   -> ${typeof detail === "string" ? detail : JSON.stringify(detail)}`}`);
};

// Business dates in India (IST), like the server.
const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" });
const day = (back) => fmt.format(new Date(Date.now() - back * 86400000));
const TODAY = day(0);
const stamp = String(Date.now()).slice(-6);
const mobileFor = (n) => `9${stamp}${String(n).padStart(3, "0")}`; // 10 digits, starts with 9

const createLabour = async (n, fields) => {
  const r = await call("POST", "/labours", { name: `ZZ M2 TEST ${fields.labourType} ${stamp}`, mobile: mobileFor(n), village: "Test", joiningDate: day(10), status: "ACTIVE", ...fields });
  return r;
};

const main = async () => {
  console.log(`Server: ${BASE}\nToday (IST): ${TODAY}\n`);
  const login = await call("POST", "/auth/login", { email: EMAIL, password: PASSWORD });
  check("login as owner", login.status === 200 && Boolean(cookie), `${login.status} ${login.message}`);
  if (!cookie) return;

  // ---- labour + rates ----
  const big = await createLabour(1, { labourType: "BIGARI", dailyRate: 650 });
  const maap = await createLabour(2, { labourType: "MAAPVALI", ratePerFourMaaps: 400 });
  const pat = await createLabour(3, { labourType: "PATLAVALE", ratePer1000PayableBricks: 700 });
  check("create Bigari / Maapvali / Patlavale", [big, maap, pat].every((r) => r.status === 201), [big.message, maap.message, pat.message]);
  if (![big, maap, pat].every((r) => r.status === 201)) return;
  const [B, M, P] = [big.data.id, maap.data.id, pat.data.id];
  console.log(`  created ${B}, ${M}, ${P}`);
  check("ids are server-made (L-###) and each labour holds only its own rate field", /^L-\d{3,}$/.test(B) && big.data.dailyRate === 650 && maap.data.ratePerFourMaaps === 400 && pat.data.ratePer1000PayableBricks === 700 && big.data.ratePerFourMaaps === undefined, big.data);
  const dup = await call("POST", "/labours", { labourType: "BIGARI", name: "ZZ M2 TEST dup", mobile: mobileFor(1), village: "x", joiningDate: day(10), dailyRate: 100 });
  check("duplicate mobile refused (409)", dup.status === 409, dup.status);

  const rate = await call("POST", `/labours/${B}/rates`, { newRate: 700, effectiveFrom: day(3), reason: "M2 test increase" });
  check("rate change saved", rate.status === 201, rate.message);
  const early = await call("POST", `/labours/${B}/rates`, { newRate: 800, effectiveFrom: day(5), reason: "M2 test backdated" });
  check("rate effective before the last change refused", early.status === 400, early.status);
  const rates = await call("GET", `/labours/${B}/rates`);
  check("rate history read back, newest first (700 then 650)", rates.data?.map((r) => r.rate).join() === "700,650", rates.data);

  // ---- attendance ----
  const att = (date, status) => call("PUT", `/attendance/${date}`, { entries: [{ labourId: B, status }] });
  const a1 = await att(day(5), "PRESENT");
  const a2 = await att(day(4), "HALF_DAY");
  const a3 = await att(day(2), "PRESENT");
  check("attendance saved for 3 days", [a1, a2, a3].every((r) => r.status === 200), [a1.message, a2.message, a3.message]);
  const hist = await call("GET", `/labours/${B}/attendance`);
  const earned = Array.isArray(hist.data) ? hist.data.reduce((sum, r) => sum + r.earned, 0) : undefined;
  check("attendance earnings from the database: 650 + 325 (half day) + 700 = 1675", earned === 1675, { earned, items: hist.data });
  const fix = await att(day(4), "PRESENT");
  const list = await call("GET", `/attendance?from=${day(6)}&labourId=${B}`);
  check("correcting a day updates the same record (3 records, none duplicated)", fix.data?.saved?.updated === 1 && list.meta?.total === 3, { fix: fix.data?.saved, total: list.meta?.total });
  const notBigari = await call("PUT", `/attendance/${day(1)}`, { entries: [{ labourId: M, status: "PRESENT" }] });
  check("attendance for a Maapvali refused", notBigari.status === 400, notBigari.status);
  const future = await call("PUT", `/attendance/${day(-1)}`, { entries: [{ labourId: B, status: "PRESENT" }] });
  check("attendance for a future date refused", future.status === 400, future.status);

  // ---- Maapvali ----
  const m1 = await call("PUT", `/maap-entries/day/${TODAY}`, { rows: [{ labourId: M, maaps: 7, note: "" }] });
  const e1 = m1.data?.items?.[0];
  check("7 maaps at 400 per 4 maaps earns 700 (proportional, nothing floored)", m1.status === 200 && e1?.earnings === 700, e1);
  const noReason = await call("PUT", `/maap-entries/day/${day(1)}`, { rows: [{ labourId: M, maaps: 3, note: "" }] });
  check("changing a previous day without a reason is refused", noReason.status === 400, noReason.status);
  const withReason = await call("PUT", `/maap-entries/day/${day(1)}`, { rows: [{ labourId: M, maaps: 3, note: "" }], reason: "M2 test back entry" });
  check("with a reason it is saved", withReason.status === 200, withReason.message);
  const mList = await call("GET", `/maap-entries?from=${day(2)}&labourId=${M}`);
  check("read back: 2 entries, 10 maaps, earnings 1000", mList.data?.length === 2 && mList.meta?.summary?.maaps === 10 && mList.meta?.summary?.earnings === 1000, mList.meta?.summary);
  const patched = await call("PATCH", `/maap-entries/${e1.id}`, { numberOfMaaps: 8, reason: "M2 test correction" });
  check("correction recalculates that entry only (8 maaps = 800)", patched.data?.earnings === 800, patched.data);
  const deleted = await call("DELETE", `/maap-entries/${e1.id}`, { reason: "M2 test delete" });
  const afterDelete = await call("GET", `/maap-entries?from=${day(2)}&labourId=${M}`);
  const withDeleted = await call("GET", `/maap-entries?from=${day(2)}&labourId=${M}&includeDeleted=true`);
  check("delete is soft: gone from totals, kept in the database", deleted.status === 200 && afterDelete.meta?.summary?.earnings === 300 && withDeleted.data?.some((e) => e.id === e1.id && e.isDeleted), { summary: afterDelete.meta?.summary });

  // ---- seasons + Patlavale ----
  const seasons = await call("GET", "/seasons");
  let season = seasons.data?.find((s) => s.startDate <= TODAY && (!s.endDate || TODAY <= s.endDate));
  if (!season) {
    const made = await call("POST", "/seasons", { name: `ZZ M2 TEST season ${stamp}`, startDate: day(30) });
    check("no season covered today: created one", made.status === 201, made.message);
    season = made.data;
  } else console.log(`  using existing season "${season.name}"`);
  if (season?.status === "CLOSED") console.log("  season is CLOSED: Patlavale checks skipped (reopen it or use another database)");
  else if (season) {
    const p1 = await call("PUT", `/production-entries/day/${TODAY}`, { rows: [{ teamId: P, maaps: 10, note: "" }] });
    const pe = p1.data?.items?.[0];
    check("10 maaps = 2,500 payable bricks, 2,750 physical bricks, earns 1,750 (maaps / 4 x 700)", pe?.newPayableBricks === 2500 && pe?.newPhysicalBricks === 2750 && pe?.newEarnings === 1750, pe);
    const p2 = await call("PUT", `/production-entries/day/${day(1)}`, { rows: [{ teamId: P, maaps: 5, note: "" }], reason: "M2 test back entry" });
    const pList = await call("GET", `/production-entries?from=${day(2)}&teamId=${P}`);
    const s = pList.meta?.summary;
    check("production is cumulative (15 maaps = 3,750 payable, 4,125 physical, earns 2,625)", p2.status === 200 && s?.payableBricks === 3750 && s?.physicalBricks === 4125 && s?.earnings === 2625, s);
  }

  // ---- everything again from a clean read ----
  const labours = await call("GET", "/labours?search=ZZ%20M2%20TEST");
  check("labours read back from the database", [B, M, P].every((id) => labours.data?.some((l) => l.id === id)), labours.data?.map((l) => l.id));

  // ---- tidy up: the API cannot delete labours, so deactivate the test ones ----
  for (const id of [B, M, P]) await call("PATCH", `/labours/${id}`, { status: "INACTIVE", statusReason: "M2 test finished" });
  console.log(`\n${passed} passed, ${failed} failed. Test labours ${B}, ${M}, ${P} were set INACTIVE and stay in the database.`);
};

main()
  .catch((err) => {
    failed += 1;
    console.error(`\nFAIL  script error: ${err.message}`);
  })
  .finally(() => process.exit(failed === 0 ? 0 : 1));
