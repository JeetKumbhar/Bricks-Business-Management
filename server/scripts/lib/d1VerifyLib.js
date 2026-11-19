// Phase 1C: READ-ONLY verification of the fixtures an earlier `verifyPhase1C.js --phase d1` run left in the TEST database.
// Pure orchestration: it receives an injected reader (native `find` only) and never any write function. It compares each stored record with the
// final state the D1 scenario is known to produce. NO per-record baseline was captured before D1 ran, so nothing here claims before/after equality;
// every check is "stored final state == expected final state" and says so.
import { FIXTURE, normalizeFilter } from "./phase1cHarness.js";
import { EXPECTED_CLUSTER_HOST, EXPECTED_DB, addDays, hostIsExpectedCluster, isValidDate, parseDbName, parseHosts } from "./patlavaleHarness.js";

export const EXIT = Object.freeze({ PASS: 0, FAIL: 1, REFUSED: 2, INCONCLUSIVE: 3 });
export const VERIFY_READABLE = Object.freeze(["labours", "rates", "attendance", "maap", "production", "payments", "seasons", "counters"]);
export const DEFAULT_IDS = Object.freeze(["L-014", "L-015", "L-016", "L-017", "L-018", "L-019"]);
const NAME = /^ZZ P1C VERIFY (R\d+) D1-(A|M|P|PAY|BAY|DEL)$/;
const FIXTURE_MOBILE = /^9009\d{6}$/; // the harness's own fake numbers; the real value is never kept or printed
const TIDY = FIXTURE.reasons.tidy;
const DELR = FIXTURE.reasons.del;

/** Expected final state of D1, derived from d1Phase (days are offsets from the window start). */
export const EXPECTED = Object.freeze({
  labours: Object.freeze({
    A: { type: "BIGARI", rateType: "DAILY_RATE", ratePaise: 65000, joinDay: 15 },
    M: { type: "MAAPVALI", rateType: "RATE_PER_FOUR_MAAPS", ratePaise: 25000, joinDay: 10 },
    P: { type: "PATLAVALE", rateType: "RATE_PER_1000_PAYABLE_BRICKS", ratePaise: 70000, joinDay: 10 },
    PAY: { type: "BIGARI", rateType: "DAILY_RATE", ratePaise: 65000, joinDay: 10 },
    BAY: { type: "BIGARI", rateType: "DAILY_RATE", ratePaise: 65000, joinDay: 16 },
    DEL: { type: "MAAPVALI", rateType: "RATE_PER_FOUR_MAAPS", ratePaise: 25000, joinDay: 25 },
  }),
  recordDay: 20, bayanaDay: 2, delPaymentDay: 21, seasonFromDay: 0, seasonToDay: 59, laboursBeforeD1: 13, seasonsBeforeD1: 3, // the last two come from the Stage 4 census, not from a captured baseline
});

/** Guards: TEST database and confirmed cluster only; read-only means NO write flags exist. */
export const checkVerifyGuards = ({ argv = [], env = {}, today } = {}) => {
  const refuse = (problem) => ({ ok: false, problem: `Refusing: ${problem}` });
  const opts = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith("--")) return refuse(`unexpected argument "${a}".`);
    const name = a.slice(2);
    if (!["confirm-db", "confirm-host", "window-start"].includes(name)) return refuse(`unknown option --${name}. This verification is read-only and takes only --confirm-db, --confirm-host and --window-start.`);
    if (name in opts) return refuse(`--${name} was given twice.`);
    const v = argv[i + 1];
    if (v === undefined || v.startsWith("--")) return refuse(`--${name} needs a value.`);
    opts[name] = v;
    i += 1;
  }
  if (String(env.NODE_ENV ?? "").toLowerCase() === "production") return refuse("NODE_ENV is production. This script only works on the TEST database.");
  const dbName = parseDbName(env.MONGODB_URI);
  if (!dbName) return refuse("MONGODB_URI has no database name.");
  if (dbName !== EXPECTED_DB) return refuse(`the database name is "${dbName}", but this script is only for "${EXPECTED_DB}".`);
  if (opts["confirm-db"] !== EXPECTED_DB) return refuse(`add --confirm-db ${EXPECTED_DB}.`);
  const parsed = parseHosts(env.MONGODB_URI);
  if (!parsed) return refuse("MONGODB_URI could not be read (host missing).");
  if (parsed.hosts.some((h) => !hostIsExpectedCluster(h))) return refuse(`the cluster host in MONGODB_URI is not the confirmed TEST cluster ${EXPECTED_CLUSTER_HOST}.`);
  if (opts["confirm-host"] !== EXPECTED_CLUSTER_HOST) return refuse(`add --confirm-host ${EXPECTED_CLUSTER_HOST}.`);
  const start = opts["window-start"] ?? FIXTURE.defaultWindowStart;
  if (!isValidDate(start)) return refuse("--window-start must be a real date written YYYY-MM-DD.");
  return { ok: true, dbName, host: EXPECTED_CLUSTER_HOST, windowStart: start };
};

const sanitize = (collection, row) => {
  if (collection !== "labours") return row;
  const { mobile, ...rest } = row;
  return { ...rest, mobileFormatOk: FIXTURE_MOBILE.test(String(mobile ?? "")) }; // the number itself is dropped here, before any check or print
};
/** Whitelisted, find-only reader. Converts 24-hex `_id` strings to real ObjectId for ObjectId-backed collections (same rule as the harness). */
export const makeReader = (raw, toObjectId) => {
  if (typeof toObjectId !== "function") throw new Error("makeReader needs toObjectId (the BSON ObjectId constructor of the live driver)");
  const reads = {};
  const read = async (collection, filter = {}) => {
    if (!VERIFY_READABLE.includes(collection)) throw new Error(`reading "${collection}" is not allowed`);
    reads[collection] = (reads[collection] ?? 0) + 1;
    return (await raw(collection, normalizeFilter(collection, filter, toObjectId))).map((r) => sanitize(collection, r));
  };
  return { read, reads };
};

const same = (a, b) => a !== undefined && b !== undefined && JSON.stringify(a) === JSON.stringify(b);

/** Runs every check. Returns { results, facts }. Each step collects ALL its discrepancies, so one report shows everything that is wrong. */
export const runVerification = async (read, { windowStart = FIXTURE.defaultWindowStart, expectedIds = DEFAULT_IDS } = {}) => {
  const results = [];
  const day = (n) => addDays(windowStart, n);
  const step = async (id, title, fn) => {
    const bad = [];
    const lines = [];
    const f = { expect: (cond, msg) => { if (!cond) bad.push(msg); return Boolean(cond); }, line: (t) => lines.push(t) };
    try {
      await fn(f);
    } catch (e) {
      bad.push(`could not complete: ${String(e?.message ?? e)}`);
    }
    results.push({ id, title, status: bad.length ? "FAIL" : "PASS", lines, problems: bad });
  };
  const info = (id, title, lines) => results.push({ id, title, status: "INFO", lines, problems: [] });
  const skipAll = (ids, why) => ids.forEach(([id, title]) => results.push({ id, title, status: "SKIPPED", lines: [why], problems: [] }));
  const ctx = {};

  await step("V0", "the six D1 fixture workers exist exactly once and are the expected ids", async (f) => {
    const all = await read("labours", {});
    ctx.totalLabours = all.length;
    const named = all.map((l) => ({ l, m: NAME.exec(String(l.name ?? "")) })).filter((x) => x.m);
    ctx.otherFixtures = all.filter((l) => String(l.name ?? "").startsWith(FIXTURE.prefix) && !NAME.test(String(l.name))).map((l) => String(l._id));
    const runs = new Set(named.map((x) => x.m[1]));
    f.expect(runs.size === 1, `expected fixtures of exactly one run, found run ids: ${[...runs].join(", ") || "none"}`);
    ctx.fixtures = {};
    for (const label of Object.keys(EXPECTED.labours)) {
      const hits = named.filter((x) => x.m[2] === label);
      f.expect(hits.length === 1, `fixture D1-${label}: expected exactly 1 labour document, found ${hits.length}`);
      if (hits.length === 1) ctx.fixtures[label] = hits[0].l;
    }
    const ids = Object.values(ctx.fixtures).map((l) => String(l._id)).sort();
    f.expect(same(ids, [...expectedIds].sort()), `fixture ids are ${ids.join(", ") || "none"}, expected ${[...expectedIds].join(", ")}`);
    ctx.run = [...runs][0];
    f.line(`run ${ctx.run}; ${Object.entries(ctx.fixtures).map(([k, l]) => `D1-${k}=${l._id}`).join(", ")}`);
  });
  const dependent = [["V1", "labour documents"], ["V2", "rate histories"], ["V3", "attendance record and history"], ["V4", "Maapvali entries and deletion fields"], ["V5", "production entry and deletion fields"], ["V6", "payments incl. the Bayana"], ["V7", "season and final status"], ["V8", "ObjectId round-trip: every record re-read by its hex id"], ["V9", "retained attendance is the only live record; Maapvali, production and payments are all non-live"]];
  if (results[0].status !== "PASS") {
    skipAll([...dependent, ["V10", "counters"]], "not checked: the fixtures could not be identified (see V0)");
    return { results, facts: { run: ctx.run } };
  }
  const L = ctx.fixtures;
  const ids = Object.values(L).map((l) => String(l._id));
  const idOf = (label) => String(L[label]._id);

  await step("V1", "labour documents (final state)", async (f) => {
    for (const [label, e] of Object.entries(EXPECTED.labours)) {
      const l = L[label];
      const p = `D1-${label} ${l._id}`;
      f.expect(l.labourType === e.type, `${p}: type ${l.labourType}, expected ${e.type}`);
      f.expect(l.status === "INACTIVE", `${p}: status ${l.status}, expected INACTIVE`);
      f.expect(l.joiningDate === day(e.joinDay), `${p}: joiningDate ${l.joiningDate}, expected ${day(e.joinDay)}`);
      f.expect(l.village === "ZZ", `${p}: village ${l.village}, expected ZZ (a refused move must not leave "ZZ changed")`);
      f.expect(l.mobileFormatOk === true, `${p}: mobile is not the fixture's own number format`);
      const h = l.statusHistory ?? [];
      f.expect(h.length === 2 && h[0]?.status === "ACTIVE" && h[1]?.status === "INACTIVE" && h[1]?.reason === TIDY, `${p}: statusHistory should be ACTIVE then INACTIVE (reason "${TIDY}"), found [${h.map((x) => x.status).join(", ")}]`);
      f.line(`${l._id} ${e.type.padEnd(9)} ${l.status} joined ${l.joiningDate} statusHistory ${h.map((x) => x.status).join(">")}`);
    }
  });
  await step("V2", "rate histories (one row per worker, first row == joining date)", async (f) => {
    const rows = await read("rates", { labourId: { $in: ids } });
    f.expect(rows.length === 6, `expected exactly 6 rate rows for the 6 fixtures, found ${rows.length}`);
    for (const [label, e] of Object.entries(EXPECTED.labours)) {
      const mine = rows.filter((r) => r.labourId === idOf(label));
      f.expect(mine.length === 1, `D1-${label}: expected exactly 1 rate row, found ${mine.length}`);
      const r = mine[0];
      if (r) {
        f.expect(r.rateType === e.rateType && r.ratePaise === e.ratePaise, `D1-${label}: rate ${r.rateType} ${r.ratePaise} paise, expected ${e.rateType} ${e.ratePaise}`);
        f.expect(r.effectiveFrom === L[label].joiningDate && r.effectiveFrom === day(e.joinDay), `D1-${label}: first rate effective ${r.effectiveFrom}, joining ${L[label].joiningDate}, expected ${day(e.joinDay)}`);
        f.line(`${idOf(label)} ${r.rateType} ${r.ratePaise} paise from ${r.effectiveFrom}`);
      }
    }
  });
  await step("V3", "attendance: one record, corrected PRESENT -> ABSENT, history kept", async (f) => {
    const rows = await read("attendance", { labourId: { $in: ids } });
    f.expect(rows.length === 1, `expected exactly 1 attendance record across the 6 fixtures, found ${rows.length}`);
    const a = rows[0];
    if (a) {
      f.expect(a.labourId === idOf("A") && a.date === day(EXPECTED.recordDay), `record is for ${a.labourId} on ${a.date}, expected ${idOf("A")} on ${day(EXPECTED.recordDay)}`);
      f.expect(a.status === "ABSENT" && a.revision === 2, `status ${a.status} revision ${a.revision}, expected ABSENT revision 2`);
      const h = a.history ?? [];
      f.expect(h.length === 1 && h[0].from === "PRESENT" && h[0].to === "ABSENT" && h[0].reason === TIDY, `history should hold exactly one PRESENT -> ABSENT entry with the tidy reason, found ${h.length} entr${h.length === 1 ? "y" : "ies"}`);
      ctx.attendanceId = String(a._id);
      f.line(`${a._id}: ${a.labourId} ${a.date} ${a.status} revision ${a.revision}, history ${h.map((x) => `${x.from}->${x.to}`).join(", ")}`);
    }
  });
  const deletion = (f, p, r, reason) => {
    f.expect(r.isDeleted === true, `${p}: isDeleted is ${r.isDeleted}, expected true`);
    f.expect(r.deletedReason === reason, `${p}: deletedReason "${r.deletedReason}", expected "${reason}"`);
    f.expect(Boolean(r.deletedAt) && Boolean(r.deletedBy), `${p}: deletedAt/deletedBy missing`);
  };
  await step("V4", "Maapvali entries: both soft-deleted, nothing live", async (f) => {
    const rows = await read("maap", { labourId: { $in: ids } });
    f.expect(rows.length === 2, `expected exactly 2 Maapvali entries across the 6 fixtures (both stored, both deleted), found ${rows.length}`);
    for (const [label, reason] of [["M", TIDY], ["DEL", DELR]]) {
      const mine = rows.filter((r) => r.labourId === idOf(label));
      f.expect(mine.length === 1, `D1-${label}: expected exactly 1 Maapvali entry, found ${mine.length}`);
      const r = mine[0];
      if (r) {
        const p = `D1-${label} entry ${r._id}`;
        f.expect(r.date === day(EXPECTED.recordDay) && r.numberOfMaaps === 4 && r.ratePaise === 25000 && r.earningsPaise === 25000, `${p}: ${r.date}, ${r.numberOfMaaps} maaps, rate ${r.ratePaise}, earnings ${r.earningsPaise}; expected ${day(EXPECTED.recordDay)}, 4, 25000, 25000`);
        deletion(f, p, r, reason);
        f.line(`${r._id}: ${r.labourId} ${r.date} ${r.numberOfMaaps} maaps ${r.earningsPaise} paise isDeleted=${r.isDeleted} reason "${r.deletedReason}" revision ${r.revision}`);
      }
    }
  });
  await step("V5", "production entry: soft-deleted, tied to the D1 season", async (f) => {
    const rows = await read("production", { teamId: { $in: ids } });
    f.expect(rows.length === 1, `expected exactly 1 production entry across the 6 fixtures, found ${rows.length}`);
    const r = rows[0];
    if (r) {
      const p = `production entry ${r._id}`;
      f.expect(r.teamId === idOf("P") && r.date === day(EXPECTED.recordDay), `${p}: team ${r.teamId} on ${r.date}, expected ${idOf("P")} on ${day(EXPECTED.recordDay)}`);
      f.expect(r.numberOfMaaps === 4 && r.payableBricks === 1000 && r.ratePaise === 70000 && r.earningsPaise === 70000, `${p}: ${r.numberOfMaaps} maaps / ${r.payableBricks} bricks / rate ${r.ratePaise} / earnings ${r.earningsPaise}; expected 4 / 1000 / 70000 / 70000`);
      deletion(f, p, r, TIDY);
      ctx.productionSeasonId = r.seasonId;
      f.line(`${r._id}: ${r.teamId} ${r.date} ${r.numberOfMaaps} maaps ${r.payableBricks} bricks ${r.earningsPaise} paise isDeleted=${r.isDeleted} reason "${r.deletedReason}" season ${r.seasonId}`);
    }
  });
  await step("V6", "payments: all three stored and voided; the Bayana is intact", async (f) => {
    const rows = await read("payments", { recipientId: { $in: ids } });
    f.expect(rows.length === 3, `expected exactly 3 payments across the 6 fixtures, found ${rows.length}`);
    const want = [["PAY", "SALARY_PAYMENT", 10000, EXPECTED.recordDay, TIDY], ["BAY", "BOOKING_ADVANCE", 10000, EXPECTED.bayanaDay, TIDY], ["DEL", "SALARY_PAYMENT", 5000, EXPECTED.delPaymentDay, DELR]];
    for (const [label, type, amount, d, reason] of want) {
      const mine = rows.filter((r) => r.recipientId === idOf(label));
      f.expect(mine.length === 1, `D1-${label}: expected exactly 1 payment, found ${mine.length}`);
      const r = mine[0];
      if (r) {
        const p = `D1-${label} payment ${r._id}`;
        f.expect(r.type === type && r.amountPaise === amount && r.date === day(d), `${p}: ${r.type} ${r.amountPaise} paise on ${r.date}; expected ${type} ${amount} on ${day(d)}`);
        deletion(f, p, r, reason);
        f.line(`${r._id}: ${r.recipientId} ${r.type} ${r.amountPaise} paise ${r.date} isDeleted=${r.isDeleted} reason "${r.deletedReason}" revision ${r.revision}`);
      }
    }
  });
  await step("V7", "season: exactly one, correct window, CLOSED", async (f) => {
    const all = await read("seasons", {});
    ctx.totalSeasons = all.length;
    const mine = all.filter((s) => s.name === `${FIXTURE.prefix} ${ctx.run} D1-SEASON`);
    f.expect(mine.length === 1, `expected exactly 1 season named "${FIXTURE.prefix} ${ctx.run} D1-SEASON", found ${mine.length}`);
    const s = mine[0];
    if (s) {
      ctx.season = s;
      f.expect(s.startDate === day(EXPECTED.seasonFromDay) && s.endDate === day(EXPECTED.seasonToDay), `window ${s.startDate}..${s.endDate}, expected ${day(EXPECTED.seasonFromDay)}..${day(EXPECTED.seasonToDay)}`);
      f.expect(s.status === "CLOSED", `status ${s.status}, expected CLOSED`);
      f.expect(s.revision >= 2, `revision ${s.revision}, expected at least 2 (created, then closed)`);
      f.expect(ctx.productionSeasonId === undefined || String(ctx.productionSeasonId) === String(s._id), `the production entry points at season ${ctx.productionSeasonId}, not ${s._id}`);
      f.line(`${s._id}: ${s.startDate}..${s.endDate} ${s.status} revision ${s.revision}`);
    }
  });
  await step("V8", "ObjectId round-trip: each ObjectId-backed record re-read by its own hex id returns exactly itself", async (f) => {
    const sets = [["rates", await read("rates", { labourId: { $in: ids } })], ["attendance", await read("attendance", { labourId: { $in: ids } })], ["maap", await read("maap", { labourId: { $in: ids } })], ["production", await read("production", { teamId: { $in: ids } })], ["payments", await read("payments", { recipientId: { $in: ids } })], ["seasons", ctx.season ? [ctx.season] : []]];
    let n = 0;
    for (const [collection, rows] of sets) {
      for (const r of rows) {
        const again = await read(collection, { _id: String(r._id) });
        f.expect(again.length === 1 && same(JSON.stringify(again[0]), JSON.stringify(r)), `${collection} ${r._id}: re-read by hex id returned ${again.length} document(s)`);
        n += 1;
      }
    }
    f.line(`${n} records re-read by hex string id (converted to ObjectId before the query)`);
  });
  await step("V9", "retained attendance is the only live record; Maapvali, production and payments are all non-live", async (f) => {
    // Attendance records are never deleted (no isDeleted field): D1 intentionally RETAINS exactly one, L-014 ABSENT. Zero attendance rows would be a failure (V3).
    const att = await read("attendance", { labourId: { $in: ids } });
    const present = att.filter((r) => r.status === "PRESENT");
    const extra = att.filter((r) => String(r._id) !== ctx.attendanceId);
    f.expect(att.some((r) => String(r._id) === ctx.attendanceId), `the retained attendance record ${ctx.attendanceId} is missing`);
    f.expect(present.length === 0, `${present.length} attendance record(s) are PRESENT (would earn money): ${present.map((r) => `${r.labourId} ${r.date}`).join(", ")}`);
    f.expect(extra.length === 0, `${extra.length} unexpected attendance record(s): ${extra.map((r) => `${r._id} ${r.labourId} ${r.date} ${r.status}`).join(", ")}`);
    const live = {
      maap: (await read("maap", { labourId: { $in: ids }, isDeleted: false })).length,
      production: (await read("production", { teamId: { $in: ids }, isDeleted: false })).length,
      payments: (await read("payments", { recipientId: { $in: ids }, isDeleted: false })).length,
    };
    for (const [k, v] of Object.entries(live)) f.expect(v === 0, `${v} live ${k} record(s) remain (all must be soft-deleted)`);
    f.line(`retained attendance record ${ctx.attendanceId} present (ABSENT earns nothing); PRESENT attendance ${present.length}; unexpected attendance ${extra.length}; live Maapvali ${live.maap}, live production ${live.production}, live payments ${live.payments}`);
  });
  await step("V10", "labour counter covers the fixtures", async (f) => {
    const counters = await read("counters", {});
    ctx.counters = counters.map((c) => `${c._id}=${c.seq}`);
    const labour = counters.filter((c) => String(c._id) === "labour");
    f.expect(labour.length === 1, `expected exactly 1 "labour" counter, found ${labour.length}`);
    const top = Math.max(...expectedIds.map((x) => Number(x.slice(2))));
    f.expect(labour[0]?.seq >= top, `labour counter is ${labour[0]?.seq}, below the highest fixture id ${top}`);
    f.line(`labour counter = ${labour[0]?.seq} (highest fixture id ${top}${labour[0]?.seq === top ? "; exactly the value D1 leaves when nothing else created a worker" : "; higher, so another worker was created after D1"})`);
  });
  info("CONTEXT", "context only (no baseline was captured; these are NOT before/after comparisons)", [
    `all counters now: ${ctx.counters?.join(", ") || "none"} (bill counters are listed here; no earlier values were captured)`,
    `labour documents now ${ctx.totalLabours}; census before D1 reported ${EXPECTED.laboursBeforeD1}, so +6 would be ${EXPECTED.laboursBeforeD1 + 6}${ctx.totalLabours === EXPECTED.laboursBeforeD1 + 6 ? " (consistent)" : " (differs: other workers were added/removed since the census, or the census figure is stale)"}`,
    `season documents now ${ctx.totalSeasons}; census before D1 reported ${EXPECTED.seasonsBeforeD1}, so +1 would be ${EXPECTED.seasonsBeforeD1 + 1}${ctx.totalSeasons === EXPECTED.seasonsBeforeD1 + 1 ? " (consistent)" : " (differs)"}`,
    `other "${FIXTURE.prefix}" workers that are not D1 fixtures: ${ctx.otherFixtures.length}${ctx.otherFixtures.length ? ` (${ctx.otherFixtures.join(", ")})` : ""}`,
  ]);
  return { results, facts: { run: ctx.run, ids } };
};

export const verdictOf = (results) => (results.some((r) => r.status === "FAIL") ? EXIT.FAIL : results.some((r) => r.status === "SKIPPED") ? EXIT.INCONCLUSIVE : EXIT.PASS);
const hide = (t) => String(t).replace(/\b\d{10}\b/g, "[number hidden]").replace(/mongodb(?:\+srv)?:\/\/\S+/gi, "[connection string hidden]");
export const formatVerifyReport = ({ results, reads }, { dbName, host } = {}) => {
  const out = [`D1 fixture verification (READ-ONLY); database ${dbName}; cluster ${host}`];
  for (const r of results) {
    out.push(`  [${r.status}] ${r.id} ${r.title}`);
    for (const l of r.lines) out.push(`        ${l}`);
    for (const p of r.problems) out.push(`        PROBLEM: ${p}`);
  }
  const n = (s) => results.filter((r) => r.status === s).length;
  out.push(`Result: ${n("PASS")} passed, ${n("FAIL")} failed, ${n("SKIPPED")} skipped, ${n("INFO")} informational`);
  out.push(`Database operations: ${Object.values(reads ?? {}).reduce((a, b) => a + b, 0)} read-only find() calls (${Object.entries(reads ?? {}).map(([k, v]) => `${k}=${v}`).join(", ")}); 0 writes (the reader exposes no write function)`);
  out.push("No before/after equality is claimed: no per-record baseline was captured before D1 ran.");
  return out.map(hide);
};
