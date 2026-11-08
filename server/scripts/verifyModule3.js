// Module 3 check against a RUNNING server and its REAL MongoDB, over the same HTTP API the frontend uses:
// payments (add, safe retry, validation, correct, void) and the server's balance / salary figures.
//
//   OWNER_EMAIL=owner@example.com OWNER_PASSWORD='...' node scripts/verifyModule3.js --i-understand-this-writes-test-data
//   (optional) API_BASE=http://localhost:5000/api   CLIENT_ORIGIN_FOR_TEST=http://localhost:5173
//
// USE A DEVELOPMENT / TEST DATABASE. It creates a "ZZ M3 TEST" labour with work and payments. Nothing can be deleted through the
// API, so the labour stays (set INACTIVE at the end) and its payments stay on record (one is voided on purpose).
// The password comes from the environment only and is never printed.

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
  const token = (res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).find((c) => c.startsWith("brickpro_token="));
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

const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" });
const day = (back) => fmt.format(new Date(Date.now() - back * 86400000));
const TODAY = day(0);
const stamp = String(Date.now()).slice(-6);
const rid = (n) => `m3-${stamp}-${n}-${Math.random().toString(36).slice(2, 8)}`; // 8 to 64 letters, digits, - or _

const main = async () => {
  console.log(`Server: ${BASE}\nToday (IST): ${TODAY}\n`);
  const login = await call("POST", "/auth/login", { email: EMAIL, password: PASSWORD });
  check("login as owner", login.status === 200 && Boolean(cookie), `${login.status} ${login.message}`);
  if (!cookie) return;

  // ---- a Bigari with known earnings: 650 (present) + 325 (half day) + 650 (present) = 1625 ----
  const made = await call("POST", "/labours", { labourType: "BIGARI", name: `ZZ M3 TEST ${stamp}`, mobile: `9${stamp}001`, village: "Test", joiningDate: day(10), status: "ACTIVE", dailyRate: 650 });
  check("create test Bigari", made.status === 201, made.message);
  if (made.status !== 201) return;
  const L = made.data.id;
  for (const [back, status] of [[5, "PRESENT"], [4, "HALF_DAY"], [2, "PRESENT"]]) await call("PUT", `/attendance/${day(back)}`, { entries: [{ labourId: L, status }] });
  const bal0 = await call("GET", `/labours/${L}/balance`);
  check("server earned 1625 from attendance, nothing received yet", bal0.data?.earned === 1625 && bal0.data?.totalReceived === 0 && bal0.data?.balance === 1625, bal0.data);

  // ---- add + safe retry ----
  const r1 = rid(1);
  const body = { recipientId: L, type: "SALARY_PAYMENT", amount: 500, date: TODAY, note: "", requestId: r1 };
  const p1 = await call("POST", "/payments", body);
  check("payment saved (201)", p1.status === 201 && p1.data?.amount === 500 && p1.data?.type === "SALARY_PAYMENT", { status: p1.status, message: p1.message });
  check("the saved payment comes back with its real 24-character id", /^[0-9a-f]{24}$/.test(String(p1.data?.id)), p1.data?.id);
  if (!/^[0-9a-f]{24}$/.test(String(p1.data?.id))) return console.log("\nStopping: a new payment came back without a real id (server bug: created.toObject() must be created.toObject({ transform: false }) in services/payment.service.js).");
  const replay = await call("POST", "/payments", body);
  check("same requestId again returns the first payment (200, replayed), no second record", replay.status === 200 && replay.meta?.replayed === true && replay.data?.id === p1.data?.id, { status: replay.status, meta: replay.meta });
  const diff = await call("POST", "/payments", { ...body, amount: 999 });
  check("same requestId with a different amount refused (409)", diff.status === 409, diff.status);
  const dup = await call("POST", "/payments", { recipientId: L, type: "SALARY_PAYMENT", amount: 500, date: TODAY });
  check("identical payment with no requestId within seconds refused as a double submit (409)", dup.status === 409, dup.status);
  const race = await Promise.all([1, 2].map(() => call("POST", "/payments", { recipientId: L, type: "SALARY_PAYMENT", amount: 111, date: TODAY, requestId: rid(2) })));
  check("two simultaneous saves with different requestIds both save (two real payments)", race.every((r) => r.status === 201), race.map((r) => r.status));
  const sameRace = (() => { const id = rid(3); return Promise.all([1, 2].map(() => call("POST", "/payments", { recipientId: L, type: "SALARY_PAYMENT", amount: 222, date: TODAY, requestId: id }))); })();
  const sr = await sameRace;
  check("two simultaneous saves with ONE requestId create one payment", sr[0].data?.id === sr[1].data?.id && sr.every((r) => [200, 201].includes(r.status)), sr.map((r) => [r.status, r.data?.id]));

  // ---- server rules ----
  const fut = await call("POST", "/payments", { recipientId: L, type: "SALARY_PAYMENT", amount: 10, date: day(-1), requestId: rid(4) });
  check("future date refused (400)", fut.status === 400, fut.status);
  const oth = await call("POST", "/payments", { recipientId: L, type: "OTHER", amount: 10, date: TODAY, note: "", requestId: rid(5) });
  check("'Other' without a note refused (400)", oth.status === 400, oth.status);
  const pre = await call("POST", "/payments", { recipientId: L, type: "SALARY_PAYMENT", amount: 10, date: day(11), requestId: rid(6) });
  check("salary payment dated before joining refused (400)", pre.status === 400, pre.status);
  const bay = await call("POST", "/payments", { recipientId: L, type: "BOOKING_ADVANCE", amount: 100, date: day(11), note: "Bayana", requestId: rid(7) });
  check("a Bayana dated before joining is accepted", bay.status === 201, bay.message);
  const str = await call("POST", "/payments", { recipientId: L, type: "SALARY_PAYMENT", amount: "50", date: TODAY, requestId: rid(8) });
  check("amount sent as text refused (400): it must be a number", str.status === 400, str.status);
  const unk = await call("POST", "/payments", { labourId: L, type: "SALARY_PAYMENT", amount: 50, date: TODAY, requestId: rid(9) });
  check("unknown field (labourId instead of recipientId) refused (400)", unk.status === 400, unk.status);

  // ---- balances: earned 1625; live payments 500 + 111 + 111 + 222 + 100 = 1044 ----
  const bal1 = await call("GET", `/labours/${L}/balance`);
  check("server balance = 1625 - 1,044 = 581 (all types count as received under the current policy)", bal1.data?.totalReceived === 1044 && bal1.data?.balance === 581, bal1.data);
  const sal = await call("GET", "/salary");
  const row = Array.isArray(sal.data) ? sal.data.find((r) => r.id === L) : undefined; // data is the rows; meta has { range, summary }
  check("salary answer has the rows in data and { range, summary } in meta", Array.isArray(sal.data) && Boolean(sal.meta?.range) && Boolean(sal.meta?.summary?.byType), { dataIsArray: Array.isArray(sal.data), meta: Object.keys(sal.meta ?? {}) });
  check("salary row agrees with the balance (earned 1625, received 1044, balance 581)", row?.season?.earned === 1625 && row?.season?.received === 1044 && row?.season?.balance === 581, row?.season);
  const stmt = await call("GET", `/salary/${L}`);
  const last = stmt.data?.lines?.at(-1);
  check("statement: last running balance equals the closing balance", stmt.status === 200 && last?.balance === stmt.data?.closing && stmt.data?.closing === 581, { closing: stmt.data?.closing, last: last?.balance });
  const wrk = await call("GET", `/attendance?from=${day(6)}&labourId=${L}`);
  check("payments never changed attendance (still 3 records)", wrk.meta?.total === 3, wrk.meta);

  // ---- correct ----
  const cor = await call("PATCH", `/payments/${p1.data.id}`, { amount: 700, reason: "Counted wrong" });
  check("correction saved (revision 2, corrected)", cor.status === 200 && cor.data?.amount === 700 && cor.data?.revision === 2 && cor.data?.corrected === true, { status: cor.status, message: cor.message });
  check("old value, and why, are kept in the revisions", cor.data?.revisions?.[0]?.before?.amount === 500 && cor.data?.revisions?.[0]?.reason === "Counted wrong", cor.data?.revisions);
  const noReason = await call("PATCH", `/payments/${p1.data.id}`, { amount: 800 });
  check("a correction without a reason is refused (400)", noReason.status === 400, noReason.status);
  const bal2 = await call("GET", `/labours/${L}/balance`);
  check("balance after correction: 581 - 200 = 381", bal2.data?.balance === 381, bal2.data?.balance);

  // ---- void ----
  const vo = await call("DELETE", `/payments/${p1.data.id}`, { reason: "Entered for the wrong week" });
  check("void saved (the record stays, marked deleted with the reason)", vo.status === 200 && vo.data?.isDeleted === true && vo.data?.deletedReason === "Entered for the wrong week", { status: vo.status, message: vo.message });
  const vo2 = await call("DELETE", `/payments/${p1.data.id}`, { reason: "again" });
  const cv = await call("PATCH", `/payments/${p1.data.id}`, { amount: 1, reason: "try it" });
  check("voiding twice, or correcting a voided payment, is refused (409)", vo2.status === 409 && cv.status === 409, [vo2.status, cv.status]);
  const bal3 = await call("GET", `/labours/${L}/balance`);
  check("balance after void: 381 + 700 = 1081 (voided payment no longer counted)", bal3.data?.balance === 1081, bal3.data?.balance);
  const listLive = await call("GET", `/payments?recipientId=${L}`);
  const listAll = await call("GET", `/payments?recipientId=${L}&includeDeleted=true`);
  check("read back from the database: voided payment hidden by default, present with includeDeleted", !listLive.data?.some((p) => p.id === p1.data.id) && listAll.data?.some((p) => p.id === p1.data.id && p.isDeleted), [listLive.data?.length, listAll.data?.length]);
  const detail = await call("GET", `/payments/${p1.data.id}`);
  check("payment detail keeps the correction trail after the void", detail.data?.revisions?.length === 1, detail.data?.revisions);

  // ---- range: salary for the last 4 days counts only work inside it ----
  const rng = await call("GET", `/salary?from=${day(3)}&to=${TODAY}`);
  const rr = Array.isArray(rng.data) ? rng.data.find((r) => r.id === L) : undefined;
  check("salary for the last 4 days: earned 650 (one present day), season balance unchanged by the range", rr?.period?.earned === 650 && rr?.season?.balance === 1081, rr);

  await call("PATCH", `/labours/${L}`, { status: "INACTIVE", statusReason: "M3 test finished" });
  console.log(`\n${passed} passed, ${failed} failed. Test labour ${L} was set INACTIVE and stays in the database.`);
};

main()
  .catch((err) => {
    failed += 1;
    console.error(`\nFAIL  script error: ${err.message}`);
  })
  .finally(() => process.exit(failed === 0 ? 0 : 1));
