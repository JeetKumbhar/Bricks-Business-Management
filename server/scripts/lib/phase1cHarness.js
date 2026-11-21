// Phase 1C Stage 4: real-MongoDB verification harness. PURE ORCHESTRATION: this file never imports a model, a driver or a service.
// Everything it touches arrives through the injected `ctx` (see verifyPhase1C.js), so the unit tests run every scenario against the
// in-memory fake. NOTHING IN THIS FILE HAS BEEN RUN AGAINST A REAL DATABASE.
//
// Safety design:
//   * one phase per run (--phase precheck|d1|d2|p6|p3), so every step is approved and reported separately;
//   * strict guards (database name, cluster host, explicit confirmations, per-phase write flags, unknown flags refused);
//   * services reach the scenarios only through gateServices(): a read-only run cannot call a write method at all;
//   * the only direct database access is `read(collection, filter)` (native find, whitelisted collections) and ONE gated fixture insert (d2);
//   * no delete, drop, index or migration capability exists anywhere in this file: fixtures are never removed, only listed in the ledger.
import { EXPECTED_CLUSTER_HOST, EXPECTED_DB, addDays, hostIsExpectedCluster, isValidDate, parseDbName, parseHosts } from "./patlavaleHarness.js";

export const EXIT = Object.freeze({ OK: 0, FAIL: 1, REFUSED: 2, INCONCLUSIVE: 3 });
export const PHASES = Object.freeze(["precheck", "d1", "d2", "p6", "p3"]);
export const WRITE_PHASES = Object.freeze(["d1", "d2", "p6", "p3"]);
export const STATUS = Object.freeze({ PASS: "PASS", FAIL: "FAIL", INCONCLUSIVE: "INCONCLUSIVE", SKIPPED: "SKIPPED" });

export const FIXTURE = Object.freeze({
  prefix: "ZZ P1C VERIFY",
  defaultWindowStart: "2001-03-01", // far in the past: no real season or production should be there (the precheck proves it)
  windowDays: 70, // [start, start+70] must hold no season and no production entry
  rounds: 8, // race rounds (P6)
  minYearsAgo: 1, // --window-start must be at least this far in the past
  reasons: Object.freeze({ day: "ZZ P1C verify day", fix: "ZZ P1C verify correction", del: "ZZ P1C verify delete", tidy: "ZZ P1C verify tidy" }),
});

/** Collections the harness may read (native find). Names are the injected reader's, not MongoDB names. */
export const READABLE = Object.freeze(["labours", "rates", "attendance", "maap", "production", "payments", "seasons", "counters", "settings", "bills"]);

const KNOWN_FLAGS = Object.freeze(["phase", "confirm-db", "confirm-host", "window-start", "i-understand-this-writes-test-data", "accept-permanent-numbering-lock", "accept-numbering-race", "allow-direct-fixture-insert", "allow-rerun"]);
const VALUE_FLAGS = new Set(["phase", "confirm-db", "confirm-host", "window-start"]);

/** Pure command-line / environment guard. Returns { ok, ... } or { ok: false, problem }. Nothing secret is ever returned. */
export const checkGuards = ({ argv = [], env = {}, today } = {}) => {
  const refuse = (problem) => ({ ok: false, problem: `Refusing: ${problem}` });
  const opts = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith("--")) return refuse(`unexpected argument "${a}".`);
    const name = a.slice(2);
    if (!KNOWN_FLAGS.includes(name)) return refuse(`unknown option --${name}.`);
    if (name in opts) return refuse(`--${name} was given twice.`);
    if (VALUE_FLAGS.has(name)) {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith("--")) return refuse(`--${name} needs a value.`);
      opts[name] = v;
      i += 1;
    } else opts[name] = true;
  }
  const phase = opts.phase;
  if (!PHASES.includes(phase)) return refuse(`add --phase ${PHASES.join("|")}.`);
  if (String(env.NODE_ENV ?? "").toLowerCase() === "production") return refuse("NODE_ENV is production. This script only works on the TEST database.");
  const dbName = parseDbName(env.MONGODB_URI);
  if (!dbName) return refuse("MONGODB_URI has no database name.");
  if (dbName !== EXPECTED_DB) return refuse(`the database name is "${dbName}", but this script is only for "${EXPECTED_DB}".`);
  if (opts["confirm-db"] !== EXPECTED_DB) return refuse(`add --confirm-db ${EXPECTED_DB}.`);
  const parsed = parseHosts(env.MONGODB_URI);
  if (!parsed) return refuse("MONGODB_URI could not be read (host missing).");
  if (parsed.hosts.some((h) => !hostIsExpectedCluster(h))) return refuse(`the cluster host in MONGODB_URI is not the confirmed TEST cluster ${EXPECTED_CLUSTER_HOST}.`);
  if (opts["confirm-host"] !== EXPECTED_CLUSTER_HOST) return refuse(`add --confirm-host ${EXPECTED_CLUSTER_HOST}.`);

  const writes = WRITE_PHASES.includes(phase);
  const writeOnlyFlags = ["i-understand-this-writes-test-data", "accept-permanent-numbering-lock", "accept-numbering-race", "allow-direct-fixture-insert", "allow-rerun"].filter((f) => opts[f]);
  if (!writes && writeOnlyFlags.length) return refuse(`the precheck is read-only; remove --${writeOnlyFlags[0]}.`);
  if (writes && !opts["i-understand-this-writes-test-data"]) return refuse("add --i-understand-this-writes-test-data (this phase creates test records in the TEST database that cannot be removed).");
  if (phase === "p3" && !opts["accept-permanent-numbering-lock"]) return refuse("add --accept-permanent-numbering-lock (the first finalized test bill permanently locks the invoice numbering of the test database).");
  if (opts["accept-numbering-race"] && phase !== "p3") return refuse("--accept-numbering-race only applies to --phase p3.");
  if (opts["allow-direct-fixture-insert"] && phase !== "d2") return refuse("--allow-direct-fixture-insert only applies to --phase d2.");

  const start = opts["window-start"] ?? FIXTURE.defaultWindowStart;
  if (!isValidDate(start)) return refuse("--window-start must be a real date written YYYY-MM-DD.");
  const limit = today ? addDays(today, -365 * FIXTURE.minYearsAgo) : null;
  if (limit && start > limit) return refuse(`--window-start must be at least ${FIXTURE.minYearsAgo} year before today (${limit} or earlier), so the fixtures stay clear of real work.`);

  return {
    ok: true, phase, dbName, host: EXPECTED_CLUSTER_HOST, windowStart: start, writes,
    flags: { permanentLock: Boolean(opts["accept-permanent-numbering-lock"]), numberingRace: Boolean(opts["accept-numbering-race"]), directInsert: Boolean(opts["allow-direct-fixture-insert"]), allowRerun: Boolean(opts["allow-rerun"]) },
  };
};

// ---------------------------------------------------------------------------------------------------------------------------------
// Service gate: every service method the scenarios may call is classified. A read-only run gets throwing stubs for all write methods.
export class WriteRefused extends Error {
  constructor(name) {
    super(`${name} is a write operation and this run is read-only`);
    this.name = "WriteRefused";
  }
}
export const SERVICE_METHODS = Object.freeze({
  labour: { read: ["getLabour", "getLabourSummary"], write: ["createLabour", "updateLabour", "nextLabourId"] }, // nextLabourId: the app's own atomic id allocator (counter $inc), used only to reserve the id of the D2 no-rate fixture
  maap: { read: [], write: ["saveDay", "deleteEntry"] },
  payment: { read: [], write: ["createPayment", "voidPayment"] },
  attendance: { read: [], write: ["saveDay"] },
  season: { read: ["getSeason"], write: ["createSeason", "updateSeason"] },
  production: { read: ["getDay"], write: ["saveDay", "correctEntry", "deleteEntry"] },
  bill: { read: ["getBill"], write: ["createDraft", "finalizeBill", "discardDraft"] },
  invoiceSettings: { read: ["getSettings", "loadSettings", "isNumberingLocked"], write: ["updateSettings"] },
  salary: { read: ["getSalarySummary", "getStatement"], write: [] },
  balance: { read: ["getBalance", "listBalances"], write: [] },
});

/** Only classified methods are exposed. With allowWrites false every write method throws WriteRefused before doing anything. */
export const gateServices = (services, { allowWrites }) => {
  const gated = {};
  for (const [group, { read, write }] of Object.entries(SERVICE_METHODS)) {
    gated[group] = {};
    for (const name of read) if (typeof services?.[group]?.[name] === "function") gated[group][name] = (...a) => services[group][name](...a);
    for (const name of write) {
      if (typeof services?.[group]?.[name] !== "function") continue;
      gated[group][name] = allowWrites ? (...a) => services[group][name](...a) : () => { throw new WriteRefused(`${group}.${name}`); };
    }
  }
  return Object.freeze(gated);
};

/**
 * Collections whose `_id` is a BSON ObjectId. Labours ("L-014"), counters ("labour") and settings ("default") have STRING ids and are never converted.
 * The native driver does not cast: find({ _id: "<24 hex>" }) matches NOTHING against an ObjectId _id (this is what failed on Atlas in D1-7 / D1-T2).
 */
export const OBJECT_ID_COLLECTIONS = Object.freeze(["rates", "attendance", "maap", "production", "payments", "seasons", "bills"]);
const HEX24 = /^[0-9a-fA-F]{24}$/;
const convertId = (value, toObjectId) => (typeof value === "string" && HEX24.test(value) ? toObjectId(value) : value);
/** Pure. Converts 24-hex strings to ObjectId for the `_id` field ONLY (direct value, $eq/$ne/$in/$nin, and inside $and/$or/$nor). Every other field is left alone. */
export const normalizeFilter = (collection, filter, toObjectId) => {
  if (!OBJECT_ID_COLLECTIONS.includes(collection) || !filter || typeof filter !== "object") return filter;
  const walk = (f) => {
    const out = {};
    for (const [key, value] of Object.entries(f)) {
      if (["$and", "$or", "$nor"].includes(key) && Array.isArray(value)) out[key] = value.map(walk);
      else if (key !== "_id") out[key] = value;
      else if (value && typeof value === "object" && !Array.isArray(value) && !("toHexString" in value)) {
        out._id = Object.fromEntries(Object.entries(value).map(([op, v]) => [op, ["$in", "$nin"].includes(op) && Array.isArray(v) ? v.map((x) => convertId(x, toObjectId)) : ["$eq", "$ne"].includes(op) ? convertId(v, toObjectId) : v]));
      } else out._id = convertId(value, toObjectId);
    }
    return out;
  };
  return walk(filter);
};
/** Restricts the injected native reader to the whitelisted collections and makes hex-string ids work against ObjectId-backed collections. */
export const gateRead = (read, toObjectId) => {
  if (typeof toObjectId !== "function") throw new Error("gateRead needs toObjectId (the BSON ObjectId constructor of the live driver)");
  return async (collection, filter = {}) => {
    if (!READABLE.includes(collection)) throw new Error(`reading "${collection}" is not allowed`);
    return read(collection, normalizeFilter(collection, filter, toObjectId));
  };
};

// ---------------------------------------------------------------------------------------------------------------------------------
export const createLedger = (onAdd) => {
  const rows = [];
  return {
    add: (collection, id, note) => {
      const row = { collection, id: String(id), note };
      rows.push(row);
      onAdd?.({ ...row }); // printed at once, so an interrupted run still shows what it created
    },
    rows: () => rows.map((r) => ({ ...r })),
  };
};

const clean = (text) => String(text ?? "").replace(/mongodb(?:\+srv)?:\/\/\S+/gi, "[connection string hidden]").slice(0, 300);
class Check extends Error {}
const check = (cond, message) => {
  if (!cond) throw new Check(message);
};
const done = (status, detail) => ({ status, detail });
const pass = (detail) => done(STATUS.PASS, detail);
const inconclusive = (detail) => done(STATUS.INCONCLUSIVE, detail);
const skipped = (detail) => done(STATUS.SKIPPED, detail);
const codeOf = (err) => err?.statusCode ?? (err ? `ERR:${err.name ?? "Error"}` : null);
const attempt = async (promise) => {
  try {
    return { ok: true, value: await promise, error: null, status: 200 };
  } catch (err) {
    return { ok: false, value: null, error: err, status: codeOf(err) };
  }
};
/** Equality that can never be satisfied by two missing values: an undefined side is a failure, not a match. Callers pass `?? null` where absence is legitimate. */
const same = (a, b) => a !== undefined && b !== undefined && JSON.stringify(a) === JSON.stringify(b);
/** Exactly one document, or a failure that names what was missing. Replaces every `(await read(...))[0]` used in an assertion. */
const must = async (ctx, collection, filter, label) => {
  const rows = await ctx.read(collection, filter);
  check(rows.length === 1, `${label}: expected exactly 1 stored document, found ${rows.length} (${collection} ${JSON.stringify(filter)})`);
  return rows[0];
};
const mustJson = async (ctx, collection, filter, label) => JSON.stringify(await must(ctx, collection, filter, label));
const moneyEq = (a, b) => Math.round(a * 100) === Math.round(b * 100);

/** Runs one named test. Never throws: an exception becomes FAIL (assertion) or FAIL with the error name (unexpected). */
export const runTest = async (id, title, fn) => {
  try {
    const out = (await fn()) ?? pass("");
    return { id, title, ...out };
  } catch (err) {
    return { id, title, status: STATUS.FAIL, detail: err instanceof Check ? err.message : `unexpected ${err?.name ?? "Error"}: ${clean(err?.message)}` };
  }
};

export const verdict = (results) => {
  if (results.some((r) => r.status === STATUS.FAIL)) return EXIT.FAIL;
  if (results.some((r) => r.status !== STATUS.PASS)) return EXIT.INCONCLUSIVE;
  return EXIT.OK;
};

// ---------------------------------------------------------------------------------------------------------------------------------
// Shared helpers
const actorOf = (ctx) => ({ id: null, name: `${FIXTURE.prefix} ${ctx.runId}` });
const nameOf = (ctx, label) => `${FIXTURE.prefix} ${ctx.runId} ${label}`;
const mobileOf = (ctx, n) => `9009${String(ctx.runNumber % 10000).padStart(4, "0")}${String(n).padStart(2, "0")}`;
const dayOf = (ctx, n) => addDays(ctx.windowStart, n);

const makeLabour = async (ctx, label, { type = "BIGARI", n, joining }) => {
  const rate = type === "PATLAVALE" ? { ratePer1000PayableBricks: 700 } : type === "MAAPVALI" ? { ratePerFourMaaps: 250 } : { dailyRate: 650 };
  const made = await ctx.svc.labour.createLabour({ labourType: type, name: nameOf(ctx, label), mobile: mobileOf(ctx, n), village: "ZZ", joiningDate: joining, status: "ACTIVE", ...rate }, actorOf(ctx));
  ctx.fixtureLabours.add(String(made.id));
  ctx.ledger.add("labours", made.id, `${type} fixture ${label}`);
  return made;
};
const makeSeason = async (ctx, label, from, to) => {
  const s = await ctx.svc.season.createSeason({ name: nameOf(ctx, label), startDate: dayOf(ctx, from), endDate: dayOf(ctx, to) }, actorOf(ctx));
  ctx.fixtureSeasons.add(String(s.id));
  ctx.ledger.add("seasons", s.id, `season ${label}`);
  return s;
};
const seasonDoc = (ctx, id) => must(ctx, "seasons", { _id: id }, `season ${id}`);
const countersMap = async (ctx) => Object.fromEntries((await ctx.read("counters", {})).map((c) => [String(c._id), c.seq]));
const settingsDoc = async (ctx) => (await ctx.read("settings", { _id: ctx.settingsId }))[0] ?? null;
const lockingBills = (ctx) => ctx.read("bills", { status: { $in: ["FINALIZED", "CANCELLED"] } });

// ---------------------------------------------------------------------------------------------------------------------------------
// PRECHECK (read-only)
export const precheckPhase = async (ctx) => {
  const out = [];
  out.push(await runTest("PRE-1", "connection facts and counts (read only)", async () => {
    const counts = {};
    for (const c of ["labours", "seasons", "production", "attendance", "bills"]) counts[c] = (await ctx.read(c, {})).length;
    return pass(`documents: ${Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(", ")}`);
  }));
  out.push(await runTest("PRE-2", "fixture window is free of seasons and production", async () => {
    const from = ctx.windowStart;
    const to = dayOf(ctx, FIXTURE.windowDays);
    const clash = (await ctx.read("seasons", {})).filter((s) => s.startDate <= to && (s.endDate ?? "9999-12-31") >= from);
    const prod = (await ctx.read("production", {})).filter((p) => p.date >= from && p.date <= to);
    if (clash.length || prod.length) return inconclusive(`window ${from}..${to} is not free (${clash.length} season(s), ${prod.length} production entr${prod.length === 1 ? "y" : "ies"}); choose another --window-start`);
    return pass(`window ${from}..${to} is free`);
  }));
  out.push(await runTest("PRE-3", "invoice numbering state (decides which P3 tests can run)", async () => {
    const doc = await settingsDoc(ctx);
    const bills = await lockingBills(ctx);
    const flag = doc?.numberingLocked === true;
    ctx.facts.p3 = { settingsExists: Boolean(doc), flagLocked: flag, lockingBills: bills.length, locked: flag || bills.length > 0 };
    const f = ctx.facts.p3;
    return pass(`settings document ${f.settingsExists ? "exists" : "absent"}; lock flag ${f.flagLocked}; finalized/cancelled bills ${f.lockingBills}; effectively locked ${f.locked}. ${f.locked ? "The first-finalization lock test cannot be shown on this database." : "The first-finalization lock test is possible (it is permanent)."}`);
  }));
  out.push(await runTest("PRE-4", "earlier fixtures of this harness", async () => {
    const mine = (await ctx.read("labours", {})).filter((l) => String(l.name ?? "").startsWith(FIXTURE.prefix));
    return pass(`${mine.length} labour fixture(s) from earlier runs already exist`);
  }));
  out.push(await runTest("PRE-5", "required transactions are supported (read-only transaction)", async () => {
    if (!ctx.probeTransaction) return skipped("no probe supplied");
    const r = await attempt(ctx.probeTransaction());
    return r.ok ? pass("a required read-only transaction ran") : inconclusive(`transaction probe failed (${r.status}): ${clean(r.error?.message)}`);
  }));
  out.push(await runTest("PRE-6", "missing-rate accounts across all existing labours (T-D2-4) and summary agreement", async () => {
    const sal = await ctx.svc.salary.getSalarySummary();
    const bal = await ctx.svc.balance.listBalances();
    const flagged = sal.items.filter((r) => r.incomplete).map((r) => r.id);
    const t = sal.summary.total;
    check(t.missingRateAccounts === flagged.length, `summary.total.missingRateAccounts (${t.missingRateAccounts}) differs from flagged rows (${flagged.length})`);
    check(sal.summary.byType.reduce((n, x) => n + x.missingRateAccounts, 0) === t.missingRateAccounts, "byType missingRateAccounts do not add up to the total");
    check(sal.summary.byType.some((x) => x.incomplete) === t.incomplete, "byType incomplete disagrees with total incomplete");
    check(bal.totals.missingRateLabours === bal.items.filter((i) => i.incomplete).length, "balance totals disagree with balance rows");
    return pass(`accounts with a missing-rate flag: ${flagged.length}${flagged.length ? ` (ids: ${flagged.slice(0, 10).join(", ")})` : ""}; salary and balance totals agree`);
  }));
  return out;
};

// ---------------------------------------------------------------------------------------------------------------------------------
// Shared by D1 / D2 (Tier B): retry guard, isolation proof, impact measurement, tidy-up through supported services only
const OWNER_FIELD = { labours: "_id", rates: "labourId", attendance: "labourId", maap: "labourId", production: "teamId", payments: "recipientId" };
const SNAPSHOT = ["labours", "rates", "attendance", "maap", "production", "payments", "seasons", "settings", "bills"];

/** Everything in the database that is NOT one of this run's fixtures, plus every counter except the labour id counter, as one string. */
const othersSnapshot = async (ctx) => {
  const parts = {};
  for (const c of SNAPSHOT) {
    let rows = await ctx.read(c, {});
    if (c === "seasons") rows = rows.filter((r) => !ctx.fixtureSeasons.has(String(r._id)));
    else if (OWNER_FIELD[c]) rows = rows.filter((r) => !ctx.fixtureLabours.has(String(r[OWNER_FIELD[c]])));
    parts[c] = rows.map((r) => JSON.stringify(r)).sort();
  }
  parts.counters = (await ctx.read("counters", {})).filter((c) => String(c._id) !== "labour").map((c) => JSON.stringify(c)).sort();
  return JSON.stringify(parts);
};
const labourSeq = async (ctx) => (await countersMap(ctx)).labour ?? 0;

/** A write phase refuses to start when an earlier run of the same phase left fixtures behind (an interrupted or repeated run). */
const retryGuard = (ctx, id, tag) => runTest(id, "no fixtures of an earlier run of this phase exist (a retry must not silently duplicate them)", async () => {
  const rows = await ctx.read("labours", {});
  const prior = rows.filter((l) => String(l.name ?? "").startsWith(`${FIXTURE.prefix} R`) && String(l.name).includes(` ${tag}-`)).map((l) => String(l._id));
  if (!prior.length) return pass("none found");
  const list = `${prior.length} earlier fixture(s): ${prior.slice(0, 10).join(", ")}`;
  if (ctx.flags.allowRerun) return pass(`${list}; continuing only because --allow-rerun was given`);
  return inconclusive(`${list}. Nothing was written. Review them (an earlier run may have been interrupted), then add --allow-rerun only if you really want a second set`);
});
const blocked = (results, ids) => [...results, ...ids.map((id) => ({ id, title: "not run", status: STATUS.SKIPPED, detail: "stopped before any write" }))];

const flatten = (m) => ({
  "labours.total": m.labours.total, "labours.active": m.labours.active, "labours.inactive": m.labours.inactive, "labours.bigari": m.labours.bigari, "labours.maapvali": m.labours.maapvali, "labours.patlavale": m.labours.patlavale,
  "salary.earned": m.salary.earned, "salary.received": m.salary.received, "salary.paid": m.salary.paid, "salary.outstanding": m.salary.outstanding, "salary.overpaid": m.salary.overpaid, "salary.overpaidCount": m.salary.overpaidCount, "salary.missingRateAccounts": m.salary.missingRateAccounts,
  "balances.labours": m.balances.labours, "balances.missingRateLabours": m.balances.missingRateLabours, "balances.earned": m.balances.earned, "balances.totalReceived": m.balances.totalReceived, "balances.balance": m.balances.balance,
});
/** The numbers the owner's Labour, Salary and Balance screens show. */
const measure = async (ctx) => {
  const labours = await ctx.svc.labour.getLabourSummary();
  const { summary } = await ctx.svc.salary.getSalarySummary();
  const { totals } = await ctx.svc.balance.listBalances();
  return { labours, salary: summary.total, balances: totals };
};
/** Every measured number must have moved by exactly the expected amount (default 0). Returns the non-zero deltas for the report. */
const expectDeltas = (before, after, expected) => {
  const b = flatten(before), a = flatten(after), moved = [];
  for (const k of Object.keys(b)) {
    const d = Math.round((a[k] - b[k]) * 100) / 100;
    const want = expected[k] ?? 0;
    check(d === want, `${k} moved by ${d}, expected ${want}`);
    if (d !== 0) moved.push(`${k} ${d > 0 ? "+" : ""}${d}`);
  }
  return moved;
};

const labourState = async (ctx, id) => JSON.stringify([await must(ctx, "labours", { _id: id }, `labour ${id}`), (await ctx.read("rates", { labourId: id })).sort((x, y) => String(x.effectiveFrom).localeCompare(String(y.effectiveFrom)))]);
const joiningInStep = async (ctx, id) => {
  const l = await must(ctx, "labours", { _id: id }, `labour ${id}`);
  const first = (await ctx.read("rates", { labourId: id })).sort((x, y) => String(x.effectiveFrom).localeCompare(String(y.effectiveFrom)))[0];
  return { ok: Boolean(first && first.effectiveFrom !== undefined && first.effectiveFrom === l.joiningDate), joining: l.joiningDate, first: first?.effectiveFrom };
};
const earnedOf = async (ctx, id) => {
  const bal = await ctx.svc.balance.getBalance(id);
  const row = (await ctx.svc.salary.getSalarySummary()).items.find((r) => r.id === id);
  const st = await ctx.svc.salary.getStatement(id);
  return { bal: bal.earned, salary: row?.season?.earned ?? null, statement: st.season.earned };
};

/** Tidy 1: correct one PRESENT day to ABSENT through the attendance service. Keeps the record and its history; earnings go back to 0. */
const absentify = async (ctx, id, date) => {
  const [before] = await ctx.read("attendance", { labourId: id, date });
  check(before && before.status === "PRESENT", "the day to reverse is not a PRESENT attendance record");
  const e0 = await earnedOf(ctx, id);
  check(e0.bal === 650 && e0.statement === 650, `before the correction earnings were ${e0.bal} / ${e0.statement}, expected 650`);
  await ctx.svc.attendance.saveDay(date, { entries: [{ labourId: id, status: "ABSENT" }], reason: FIXTURE.reasons.tidy }, actorOf(ctx));
  const rows = await ctx.read("attendance", { labourId: id });
  const after = rows[0];
  check(rows.length === 1 && String(after._id) === String(before._id), "the attendance record was replaced or duplicated instead of corrected");
  check(after.status === "ABSENT" && after.revision === before.revision + 1, "status or revision is wrong after the correction");
  const hist = after.history ?? [];
  check(hist.length === (before.history ?? []).length + 1, "the correction did not add exactly one history entry");
  check(hist[hist.length - 1].from === "PRESENT" && hist[hist.length - 1].to === "ABSENT" && hist[hist.length - 1].reason === FIXTURE.reasons.tidy, "the history entry does not record PRESENT -> ABSENT with the reason");
  const e1 = await earnedOf(ctx, id);
  check(e1.bal === 0 && e1.statement === 0 && (e1.salary === null || e1.salary === 0), `after the correction earnings are ${JSON.stringify(e1)}, expected 0 everywhere`);
  return `${id}: PRESENT -> ABSENT, history entries ${hist.length}, earnings ${e0.bal} -> ${e1.bal}`;
};
/** Tidy 2: set a fixture worker INACTIVE through updateLabour, with a reason; the older statusHistory must stay. */
const deactivate = async (ctx, id) => {
  const before = await must(ctx, "labours", { _id: id }, `labour ${id}`);
  await ctx.svc.labour.updateLabour(id, { status: "INACTIVE", statusReason: FIXTURE.reasons.tidy }, actorOf(ctx));
  const after = await must(ctx, "labours", { _id: id }, `labour ${id}`);
  check(after.status === "INACTIVE", `${id} is not INACTIVE`);
  const h = after.statusHistory ?? [];
  check(h.length === (before.statusHistory ?? []).length + 1 && same(h.slice(0, -1), before.statusHistory ?? []), `${id}: earlier statusHistory was not preserved`);
  check(h[h.length - 1].status === "INACTIVE" && h[h.length - 1].reason === FIXTURE.reasons.tidy, `${id}: the INACTIVE entry does not carry the tidy reason`);
  const bal = await ctx.svc.balance.getBalance(id);
  check(bal.earned === 0 && bal.balance === 0, `${id}: not at zero after tidy (earned ${bal.earned}, balance ${bal.balance})`);
};

// ---------------------------------------------------------------------------------------------------------------------------------
// D1: joining-date correction (Tier B). Six fixture workers, one per rule; every move targets only its own worker.
export const d1Phase = async (ctx) => {
  const out = [];
  const guard = await retryGuard(ctx, "D1-LOCK", "D1");
  out.push(guard);
  const ALL = ["D1-0", "D1-1", "D1-2", "D1-3", "D1-4", "D1-5", "D1-6", "D1-7", "D1-8", "D1-T1", "D1-T2", "D1-T3", "D1-IMPACT", "D1-ISO"];
  if (guard.status !== STATUS.PASS) return blocked(out, ALL);
  const s = {};
  const JOIN = 10, REC = 20, LATE = 25;
  const base = { snapshot: await othersSnapshot(ctx), measure: await measure(ctx), seq: await labourSeq(ctx) };
  const actor = actorOf(ctx);
  const payment = async (labour, type, amount, day) => {
    await ctx.svc.payment.createPayment({ recipientId: labour.id, type, amount, date: dayOf(ctx, day), method: "CASH", note: "ZZ P1C verify" }, actor);
    const rows = (await ctx.read("payments", { recipientId: labour.id, isDeleted: false })).filter((p) => p.type === type);
    check(rows.length === 1, `payment ${type} for ${labour.id}: expected exactly 1 stored payment, found ${rows.length}`);
    const row = rows[0];
    ctx.ledger.add("payments", row._id, `${type} Rs ${amount} dated ${dayOf(ctx, day)} (${labour.id})`);
    return String(row._id);
  };
  const maapEntry = async (labour, day) => {
    await ctx.svc.maap.saveDay(dayOf(ctx, day), { rows: [{ labourId: labour.id, maaps: 4 }], reason: FIXTURE.reasons.day }, actor);
    const row = await must(ctx, "maap", { labourId: labour.id, isDeleted: false }, `Maapvali entry for ${labour.id}`);
    ctx.ledger.add("maap", row._id, `${dayOf(ctx, day)} (${labour.id})`);
    return String(row._id);
  };
  out.push(await runTest("D1-0", "setup: six fixture workers (attendance, Maapvali, Patlavale, salary payment, Bayana, soft-deleted)", async () => {
    s.a = await makeLabour(ctx, "D1-A", { n: 1, joining: dayOf(ctx, JOIN) });
    await ctx.svc.attendance.saveDay(dayOf(ctx, REC), { entries: [{ labourId: s.a.id, status: "PRESENT" }], reason: FIXTURE.reasons.day }, actor);
    ctx.ledger.add("attendance", `${s.a.id}@${dayOf(ctx, REC)}`, "PRESENT");
    s.m = await makeLabour(ctx, "D1-M", { type: "MAAPVALI", n: 2, joining: dayOf(ctx, JOIN) });
    s.mEntry = await maapEntry(s.m, REC);
    s.season = await makeSeason(ctx, "D1-SEASON", 0, 59);
    s.p = await makeLabour(ctx, "D1-P", { type: "PATLAVALE", n: 3, joining: dayOf(ctx, JOIN) });
    await ctx.svc.production.saveDay(dayOf(ctx, REC), { rows: [{ teamId: s.p.id, maaps: 4 }], reason: FIXTURE.reasons.day }, actor);
    s.pEntry = String((await must(ctx, "production", { teamId: s.p.id, isDeleted: false }, `production entry for ${s.p.id}`))._id);
    ctx.ledger.add("production", s.pEntry, `${dayOf(ctx, REC)} (${s.p.id})`);
    s.pay = await makeLabour(ctx, "D1-PAY", { n: 4, joining: dayOf(ctx, JOIN) });
    s.payId = await payment(s.pay, "SALARY_PAYMENT", 100, REC);
    s.bay = await makeLabour(ctx, "D1-BAY", { n: 5, joining: dayOf(ctx, JOIN) });
    s.bayId = await payment(s.bay, "BOOKING_ADVANCE", 100, 2);
    s.del = await makeLabour(ctx, "D1-DEL", { type: "MAAPVALI", n: 6, joining: dayOf(ctx, JOIN) });
    s.delEntry = await maapEntry(s.del, REC);
    s.delPay = await payment(s.del, "SALARY_PAYMENT", 50, REC + 1);
    await ctx.svc.maap.deleteEntry(s.delEntry, { reason: FIXTURE.reasons.del }, actor);
    await ctx.svc.payment.voidPayment(s.delPay, { reason: FIXTURE.reasons.del }, actor);
    return pass("6 workers, 1 season, entries and payments created; D1-DEL's entry and payment are soft-deleted");
  }));
  if (!s.del || !s.delPay) return [...out, ...ALL.slice(1).map((id) => ({ id, title: "not run", status: STATUS.SKIPPED, detail: "setup did not finish" }))];

  out.push(await runTest("D1-1", "valid corrections: earlier, then later but before the first record; the first rate row moves with it", async () => {
    for (const day of [5, 15]) {
      const r = await attempt(ctx.svc.labour.updateLabour(s.a.id, { joiningDate: dayOf(ctx, day) }, actor));
      check(r.ok, `moving the joining date to ${dayOf(ctx, day)} was refused (${r.status}): ${clean(r.error?.message)}`);
      const step = await joiningInStep(ctx, s.a.id);
      check(step.ok && step.joining === dayOf(ctx, day), `joining ${step.joining} and first rate ${step.first} are not both ${dayOf(ctx, day)}`);
    }
    return pass("moved to day 5, then day 15; joining date and first rate row identical each time");
  }));
  const conflict = async (id, label) => {
    const before = await labourState(ctx, id);
    const r = await attempt(ctx.svc.labour.updateLabour(id, { joiningDate: dayOf(ctx, LATE), village: "ZZ changed" }, actor));
    check(!r.ok && r.status === 409, `expected 409, got ${r.ok ? "success (the move was ALLOWED)" : r.status}`);
    check(new RegExp(label, "i").test(r.error.message), `the 409 should name the ${label}: ${clean(r.error.message)}`);
    check(before === (await labourState(ctx, id)), "the worker or its rate rows changed although the move was refused");
    return pass(`refused: ${clean(r.error.message)}`);
  };
  out.push(await runTest("D1-2", "attendance conflict: refused 409, nothing changed", () => conflict(s.a.id, "attendance")));
  out.push(await runTest("D1-3", "Maapvali entry conflict: refused 409, nothing changed", () => conflict(s.m.id, "Maapvali entry")));
  out.push(await runTest("D1-4", "Patlavale production conflict: refused 409, nothing changed", () => conflict(s.p.id, "Patlavale production entry")));
  out.push(await runTest("D1-5", "non-Bayana payment conflict: refused 409, nothing changed", () => conflict(s.pay.id, "payment")));
  out.push(await runTest("D1-6", "Bayana (dated before joining) never blocks a move; the real stored Bayana is identical before and after", async () => {
    const stored = await must(ctx, "payments", { _id: s.bayId }, "Bayana payment");
    check(stored.type === "BOOKING_ADVANCE" && stored.date === dayOf(ctx, 2) && stored.isDeleted === false && stored.recipientId === s.bay.id, `the stored payment is not the expected live Bayana (type ${stored.type}, date ${stored.date}, deleted ${stored.isDeleted})`);
    const before = JSON.stringify(stored);
    const r = await attempt(ctx.svc.labour.updateLabour(s.bay.id, { joiningDate: dayOf(ctx, 16) }, actor));
    check(r.ok, `the move was refused (${r.status}): ${clean(r.error?.message)}`);
    check((await joiningInStep(ctx, s.bay.id)).ok, "joining date and first rate row are not in step");
    check(before === (await mustJson(ctx, "payments", { _id: s.bayId }, "Bayana payment after the move")), "the Bayana payment changed");
    return pass("moved to day 16 although a Bayana is dated day 2; the stored Bayana document is byte-identical");
  }));
  out.push(await runTest("D1-7", "soft-deleted entry and voided payment exist, are ignored by the move, and stay stored as deleted", async () => {
    const entry = await must(ctx, "maap", { _id: s.delEntry }, "soft-deleted Maapvali entry");
    const pay = await must(ctx, "payments", { _id: s.delPay }, "voided payment");
    check(entry.isDeleted === true && entry.labourId === s.del.id, "the Maapvali entry is not a soft-deleted record of this fixture");
    check(pay.isDeleted === true && pay.recipientId === s.del.id, "the payment is not a voided record of this fixture");
    const before = [JSON.stringify(entry), JSON.stringify(pay)];
    const r = await attempt(ctx.svc.labour.updateLabour(s.del.id, { joiningDate: dayOf(ctx, LATE) }, actor));
    check(r.ok, `the move was refused although only deleted records exist (${r.status}): ${clean(r.error?.message)}`);
    check((await joiningInStep(ctx, s.del.id)).ok, "joining date and first rate row are not in step");
    const after = [await mustJson(ctx, "maap", { _id: s.delEntry }, "Maapvali entry after the move"), await mustJson(ctx, "payments", { _id: s.delPay }, "payment after the move")];
    check(before[0] === after[0] && before[1] === after[1], "a deleted record changed during the move");
    return pass("moved to day 25; both deleted records exist, still marked deleted, byte-identical");
  }));
  out.push(await runTest("D1-8", "every fixture worker: joining date equals its first rate row", async () => {
    for (const w of [s.a, s.m, s.p, s.pay, s.bay, s.del]) {
      const step = await joiningInStep(ctx, w.id);
      check(step.ok, `${w.id}: joining ${step.joining}, first rate ${step.first}`);
    }
    return pass("6 of 6 in step");
  }));

  out.push(await runTest("D1-T1", "tidy: PRESENT -> ABSENT keeps the record and its history and reverses the earnings", async () => pass(await absentify(ctx, s.a.id, dayOf(ctx, REC)))));
  out.push(await runTest("D1-T2", "tidy: each live entry and payment is soft-deleted/voided and verified, then the fixture season is closed and read back", async () => {
    const reason = FIXTURE.reasons.tidy;
    const flagged = async (collection, id, label) => {
      const row = await must(ctx, collection, { _id: id }, label);
      check(row.isDeleted === true, `${label} is not marked deleted after the operation`);
      return row;
    };
    await ctx.svc.maap.deleteEntry(s.mEntry, { reason }, actor);
    await flagged("maap", s.mEntry, "Maapvali entry D1-M");
    await ctx.svc.production.deleteEntry(s.pEntry, { reason }, actor);
    await flagged("production", s.pEntry, "production entry D1-P");
    await ctx.svc.payment.voidPayment(s.payId, { reason }, actor);
    await flagged("payments", s.payId, "salary payment D1-PAY");
    await ctx.svc.payment.voidPayment(s.bayId, { reason }, actor);
    const bay = await flagged("payments", s.bayId, "Bayana D1-BAY");
    check(bay.type === "BOOKING_ADVANCE" && bay.amountPaise === 10000, "the voided Bayana lost its amount or type");
    await ctx.svc.season.updateSeason(s.season.id, { status: "CLOSED" }, actor);
    const season = await must(ctx, "seasons", { _id: s.season.id }, "fixture season");
    check(season.status === "CLOSED", `the fixture season is ${season.status}, expected CLOSED`);
    return pass("2 entries soft-deleted, 2 payments voided (each read back by its real id), season read back as CLOSED; all rows remain stored");
  }));
  out.push(await runTest("D1-T3", "tidy: all six fixture workers INACTIVE, status history kept, balances at zero", async () => {
    for (const w of [s.a, s.m, s.p, s.pay, s.bay, s.del]) await deactivate(ctx, w.id);
    return pass("6 of 6 INACTIVE with the tidy reason; earned 0 and balance 0 each");
  }));
  out.push(await runTest("D1-IMPACT", "permanent effect on Labour, Salary and Balance numbers (measured)", async () => {
    const moved = expectDeltas(base.measure, await measure(ctx), { "labours.total": 6, "labours.inactive": 6, "labours.bigari": 3, "labours.maapvali": 2, "labours.patlavale": 1, "balances.labours": 6 });
    return pass(`only these moved: ${moved.join(", ")}. Money totals, overpaid, missing-rate counts unchanged`);
  }));
  out.push(await runTest("D1-ISO", "isolation: nothing outside this run's fixtures changed; the labour id counter moved by exactly 6", async () => {
    check(base.snapshot === (await othersSnapshot(ctx)), "a record outside this run's fixtures (or a counter other than the labour id counter) changed");
    const moved = (await labourSeq(ctx)) - base.seq;
    check(moved === 6, `the labour id counter moved by ${moved}, expected 6`);
    return pass("all other labours, rates, attendance, entries, payments, seasons, settings, bills and counters identical before and after");
  }));
  return out;
};

// ---------------------------------------------------------------------------------------------------------------------------------
// D2 / C1: missing-rate flags and summary agreement (Tier B)
export const d2Phase = async (ctx) => {
  const out = [];
  const guard = await retryGuard(ctx, "D2-LOCK", "D2");
  out.push(guard);
  const ALL = ["D2-0", "D2-1", "D2-2", "D2-3", "D2-T", "D2-IMPACT", "D2-ISO"];
  if (guard.status !== STATUS.PASS) return blocked(out, ALL);
  const s = {};
  const actor = actorOf(ctx);
  const base = { snapshot: await othersSnapshot(ctx), measure: await measure(ctx), seq: await labourSeq(ctx) };
  const DAY = dayOf(ctx, 70); // outside the D1 and P6 seasons (D1 closes its season): a closed season accepts no ordinary attendance
  out.push(await runTest("D2-0", "setup: a normally rated Bigari with one PRESENT day", async () => {
    s.ok = await makeLabour(ctx, "D2-OK", { n: 11, joining: dayOf(ctx, 10) });
    await ctx.svc.attendance.saveDay(DAY, { entries: [{ labourId: s.ok.id, status: "PRESENT" }], reason: FIXTURE.reasons.day }, actor);
    ctx.ledger.add("attendance", `${s.ok.id}@${DAY}`, "PRESENT");
    return pass(`labour ${s.ok.id}`);
  }));
  if (!s.ok) return [...out, ...ALL.slice(1).map((id) => ({ id, title: "not run", status: STATUS.SKIPPED, detail: "setup failed" }))];
  const allViews = async (id) => ({ bal: await ctx.svc.balance.getBalance(id), row: (await ctx.svc.salary.getSalarySummary()).items.find((r) => r.id === id), st: await ctx.svc.salary.getStatement(id) });
  out.push(await runTest("D2-1", "rated worker: no flag, and balance / salary / statement agree", async () => {
    const { bal, row, st } = await allViews(s.ok.id);
    check(bal.incomplete === false && bal.missingRateDays === 0, "balance flags a worker that has a rate");
    check(row && row.incomplete === false && st.incomplete === false, "salary or statement flags a worker that has a rate");
    check(bal.earned === 650, `balance earned is ${bal.earned}, expected 650 (one present day at 650)`);
    check(moneyEq(bal.earned, row.season.earned) && moneyEq(bal.earned, st.season.earned), "balance, salary and statement disagree on earnings");
    return pass("earned 650 in all three views, no flag");
  }));
  out.push(await runTest("D2-2", "worker with NO rate row: flagged in balance, salary and statement; earns nothing; clearly identifiable", async () => {
    if (!ctx.flags.directInsert) return skipped("needs --allow-direct-fixture-insert: the app cannot create a worker without a rate row, so ONE fixture labour is inserted directly (no rate row).");
    const id = await ctx.reserveLabourId(); // L-nnn from the app's allocator (D2-OK already took the previous number)
    check(Number(id.slice(2)) === (await labourSeq(ctx)), `reserved ${id} but the labour counter is ${await labourSeq(ctx)}: another worker was created meanwhile`);
    ctx.ledger.add("counters", "labour", `advanced to ${Number(id.slice(2))} by reserving ${id} (the app's own allocator)`);
    const doc = { _id: id, labourType: "BIGARI", name: nameOf(ctx, "D2-NORATE"), mobile: mobileOf(ctx, 12), village: "ZZ", joiningDate: dayOf(ctx, 10), status: "ACTIVE" };
    try {
      await ctx.insertLegacyLabour(doc);
    } catch (err) {
      if (err instanceof WriteRefused && /collision/.test(err.message)) return inconclusive(`${clean(err.message)}; nothing was inserted or overwritten`);
      throw err;
    }
    ctx.ledger.add("labours", id, "legacy-shaped BIGARI fixture with NO rate row (direct insert; stays flagged and untouched)");
    await ctx.svc.attendance.saveDay(DAY, { entries: [{ labourId: id, status: "PRESENT" }], reason: FIXTURE.reasons.day }, actor);
    ctx.ledger.add("attendance", `${id}@${DAY}`, "PRESENT (earns 0: no rate)");
    s.flagged = id;
    const { bal, row, st } = await allViews(id);
    check(bal.incomplete === true && bal.missingRateDays === 1 && bal.earned === 0, `balance: incomplete=${bal.incomplete}, missingRateDays=${bal.missingRateDays}, earned=${bal.earned}`);
    check(row?.incomplete === true && row.missingRate.days === 1 && row.missingRate.firstDate === DAY && row.season.earned === 0 && row.period.earned === 0, "salary row is not flagged correctly or earns money");
    check(st.incomplete === true && st.lines.filter((l) => l.kind === "ATTENDANCE").every((l) => l.rate === null && l.rateMissing === true && l.earned === 0), "statement lines are not flagged correctly or earn money");
    check(moneyEq(bal.earned, row.season.earned) && moneyEq(bal.earned, st.season.earned), "balance, salary and statement disagree on earnings");
    check((await ctx.read("rates", { labourId: id })).length === 0, "the flagged fixture unexpectedly has a rate row");
    const stored = await must(ctx, "labours", { _id: id }, `flagged fixture ${id}`);
    check(stored.status === "ACTIVE" && String(stored.name).startsWith(FIXTURE.prefix) && String(stored.name).endsWith("D2-NORATE") && LABOUR_ID.test(id), "the flagged fixture is not identifiable by its name and ACTIVE status, or its id is not a normal labour id");
    return pass(`flagged in all three views; earned 0 everywhere; no rate row; normal id ${id}, name ZZ P1C VERIFY ... D2-NORATE, still ACTIVE`);
  }));
  out.push(await runTest("D2-3", "summary.byType and summary.total agree (whole test database)", async () => {
    const { summary } = await ctx.svc.salary.getSalarySummary();
    const t = summary.total;
    check(summary.byType.reduce((n, x) => n + x.missingRateAccounts, 0) === t.missingRateAccounts, "byType missingRateAccounts do not add up to total");
    check(summary.byType.some((x) => x.incomplete) === t.incomplete, "byType incomplete disagrees with total");
    check(moneyEq(summary.byType.reduce((n, x) => n + x.earned, 0), t.earned), "byType earned does not add up to total earned");
    if (s.flagged) {
      check(t.incomplete === true && t.missingRateAccounts >= 1, "the flagged fixture is missing from the total");
      check(summary.byType.find((x) => x.type === "BIGARI").missingRateAccounts >= 1, "the flagged fixture is missing from the BIGARI type summary");
    }
    return pass(`total missingRateAccounts ${t.missingRateAccounts}; byType agrees`);
  }));
  out.push(await runTest("D2-T", "tidy the RATED fixture only: PRESENT -> ABSENT (history kept, earnings reversed), then INACTIVE; the no-rate fixture is not touched", async () => {
    const frozen = async () => JSON.stringify([await must(ctx, "labours", { _id: s.flagged }, "flagged fixture"), await ctx.read("attendance", { labourId: s.flagged })]);
    const before = s.flagged ? await frozen() : null;
    const detail = await absentify(ctx, s.ok.id, DAY);
    await deactivate(ctx, s.ok.id);
    if (s.flagged) check(before === (await frozen()), "the no-rate fixture or its attendance changed during tidy");
    return pass(`${detail}; INACTIVE; ${s.flagged ? "no-rate fixture left exactly as inserted (flagged, ACTIVE)" : "no no-rate fixture in this run"}`);
  }));
  out.push(await runTest("D2-IMPACT", "permanent effect on Labour, Salary and Balance numbers (measured)", async () => {
    const f = s.flagged ? 1 : 0;
    const after = await measure(ctx);
    const moved = expectDeltas(base.measure, after, { "labours.total": 1 + f, "labours.inactive": 1, "labours.active": f, "labours.bigari": 1 + f, "balances.labours": 1 + f, "salary.missingRateAccounts": f, "balances.missingRateLabours": f });
    if (f) check(after.salary.incomplete === true && after.balances.incomplete === true, "the totals do not carry the incomplete flag although a flagged fixture exists");
    return pass(`only these moved: ${moved.join(", ")}. Earned, received, paid, outstanding and overpaid money totals unchanged${f ? "; the totals now show incomplete = true because of the flagged ZZ fixture" : ""}`);
  }));
  out.push(await runTest("D2-ISO", "isolation: nothing outside this run's fixtures changed; the labour id counter moved by exactly 1 (2 when the no-rate fixture was reserved)", async () => {
    check(base.snapshot === (await othersSnapshot(ctx)), "a record outside this run's fixtures (or a counter other than the labour id counter) changed");
    const moved = (await labourSeq(ctx)) - base.seq;
    const want = s.flagged ? 2 : 1; // D2-OK takes one number; the no-rate fixture reserves the next
    check(moved === want, `the labour id counter moved by ${moved}, expected ${want}`);
    if (s.flagged) check(Number(s.flagged.slice(2)) === Number(s.ok.id.slice(2)) + 1, `the no-rate fixture ${s.flagged} is not the number right after ${s.ok.id}`);
    return pass("all other records and counters identical before and after");
  }));
  return out;
};

// ---------------------------------------------------------------------------------------------------------------------------------
// P6: season concurrency
const prodRows = (ctx, ids) => ctx.read("production", { teamId: { $in: ids }, isDeleted: false });
const inWindow = (season, date) => season && season.startDate <= date && (season.endDate == null || date <= season.endDate);

const P6_ALL = ["P6-LOCK", "P6-PRE", "P6-0", "P6-1", "P6-2", "P6-3", "P6-4", "P6-T", "P6-IMPACT", "P6-ISO"];
const P6_FROM = 0; // S1 = day 0..29, S2 = day 30..59 (the whole fixture window is day 0..59)
const P6_TO = 59;

/**
 * READ-ONLY. Refuses, before any write, when the fixture window (or any other name/mobile the run would create) collides with something that exists.
 * Overlap rule = the application's own: two seasons overlap when start <= other's end and other's start <= end; an open-ended season (endDate null) runs forever.
 * It looks at EVERY existing season whatever its status, so it works for any --window-start the owner chooses.
 */
export const p6PreflightProblems = ({ seasons, labours, windowFrom, windowTo, seasonNames, mobiles }) => {
  const problems = [];
  for (const x of seasons) {
    const end = x.endDate ?? "9999-12-31";
    if (windowFrom <= end && x.startDate <= windowTo) problems.push(`the P6 window ${windowFrom}..${windowTo} overlaps the existing season "${x.name}" (${x.startDate}..${x.endDate ?? "ongoing"}, ${x.status}). Choose another --window-start`);
    if (seasonNames.includes(String(x.name))) problems.push(`a season named "${x.name}" already exists`);
  }
  for (const l of labours) if (mobiles.includes(String(l.mobile))) problems.push(`a worker ${l._id} already uses a mobile number this run would create`);
  return problems;
};

/**
 * Best-effort tidy of whatever P6 fixtures exist, using only normal application services. Order matters: seasons must be writable while entries are
 * soft-deleted (a delete is a guarded write to its season), and only then are the workers deactivated and the seasons closed. Nothing is ever hard-deleted, created or retried;
 * every step is attempted independently and every failure is reported with what remains, so a half-finished tidy is visible, never hidden.
 */
const tidyP6 = async (ctx, s) => {
  const actor = actorOf(ctx);
  const seasons = [s.s1 && { f: s.s1, label: "S1", to: P6_FROM + 29 }, s.s2 && { f: s.s2, label: "S2", to: P6_TO }].filter(Boolean);
  const teams = s.teams ?? [];
  const failures = [];
  const step = async (label, fn) => {
    try {
      await fn();
    } catch (err) {
      failures.push(`${label}: ${clean(err?.message)}`);
    }
  };
  const log = [];
  // 1. seasons writable (OPEN, original end date). A race may have left one CLOSED or shortened.
  for (const x of seasons) {
    await step(`make season ${x.label} writable`, async () => {
      let doc = await must(ctx, "seasons", { _id: x.f.id }, `season ${x.label}`);
      if (doc.status !== "OPEN") await ctx.svc.season.updateSeason(x.f.id, { status: "OPEN" }, actor);
      doc = await must(ctx, "seasons", { _id: x.f.id }, `season ${x.label}`);
      if (doc.endDate !== dayOf(ctx, x.to)) await ctx.svc.season.updateSeason(x.f.id, { endDate: dayOf(ctx, x.to) }, actor);
      check((await must(ctx, "seasons", { _id: x.f.id }, `season ${x.label}`)).status === "OPEN", `season ${x.label} is not OPEN`);
    });
  }
  // 2. soft-delete every live fixture entry (history kept, reason recorded), verifying each by its real id
  const live = teams.length ? await prodRows(ctx, teams.map((t) => t.id)) : [];
  log.push(`${live.length} live entr${live.length === 1 ? "y" : "ies"} found`);
  for (const e of live) {
    await step(`delete entry ${e._id} (${e.date})`, async () => {
      await ctx.svc.production.deleteEntry(String(e._id), { reason: FIXTURE.reasons.tidy }, actor);
      const row = await must(ctx, "production", { _id: String(e._id) }, `entry ${e._id}`);
      check(row.isDeleted === true && row.deletedReason === FIXTURE.reasons.tidy, "not marked deleted with the tidy reason");
    });
  }
  // 3. workers INACTIVE (earnings are already 0 because no live entry remains)
  for (const t of teams) await step(`deactivate ${t.id}`, () => deactivate(ctx, t.id));
  // 4. seasons CLOSED
  for (const x of seasons) {
    await step(`close season ${x.label}`, async () => {
      await ctx.svc.season.updateSeason(x.f.id, { status: "CLOSED" }, actor);
      check((await must(ctx, "seasons", { _id: x.f.id }, `season ${x.label}`)).status === "CLOSED", "not CLOSED afterwards");
    });
  }
  // final state
  await step("final state", async () => {
    if (teams.length) check((await prodRows(ctx, teams.map((t) => t.id))).length === 0, "live fixture entries remain");
  });
  return { failures, log };
};

export const p6Phase = async (ctx) => {
  const out = [];
  const guard = await retryGuard(ctx, "P6-LOCK", "P6");
  out.push(guard);
  if (guard.status !== STATUS.PASS) return blocked(out, P6_ALL.slice(1));
  const names = ["P6-S1", "P6-S2"].map((l) => nameOf(ctx, l));
  const pre = await runTest("P6-PRE", "read-only preflight: the fixture window and names collide with nothing that exists", async () => {
    const problems = p6PreflightProblems({ seasons: await ctx.read("seasons", {}), labours: await ctx.read("labours", {}), windowFrom: dayOf(ctx, P6_FROM), windowTo: dayOf(ctx, P6_TO), seasonNames: names, mobiles: [mobileOf(ctx, 21), mobileOf(ctx, 22)] });
    check(problems.length === 0, `REFUSED before any write: ${problems.join("; ")}`);
    return pass(`window ${dayOf(ctx, P6_FROM)}..${dayOf(ctx, P6_TO)} is free of every existing season; no name or mobile clash`);
  });
  out.push(pre);
  if (pre.status !== STATUS.PASS) return blocked(out, P6_ALL.slice(2));
  const s = { teams: [] };
  const base = { snapshot: await othersSnapshot(ctx), measure: await measure(ctx), seq: await labourSeq(ctx) };
  const teamRows = (maaps) => s.teams.map((t) => ({ teamId: t.id, maaps }));
  out.push(await runTest("P6-0", "setup: two Patlavale teams, an open season and one saved production day", async () => {
    s.teams.push(await makeLabour(ctx, "P6-T1", { type: "PATLAVALE", n: 21, joining: dayOf(ctx, 0) })); // recorded one by one, so a failure part-way is still tidied
    s.teams.push(await makeLabour(ctx, "P6-T2", { type: "PATLAVALE", n: 22, joining: dayOf(ctx, 0) }));
    s.s1 = await makeSeason(ctx, "P6-S1", P6_FROM, 29);
    s.s2 = await makeSeason(ctx, "P6-S2", 30, P6_TO);
    const rev0 = (await seasonDoc(ctx, s.s1.id)).revision;
    s.day = dayOf(ctx, 5);
    await ctx.svc.production.saveDay(s.day, { rows: teamRows(4), reason: FIXTURE.reasons.day }, actorOf(ctx));
    const rev1 = (await seasonDoc(ctx, s.s1.id)).revision;
    check(rev1 === rev0 + 1, `season revision went ${rev0} -> ${rev1}; a changing save must bump it by exactly 1`);
    s.entries = await prodRows(ctx, s.teams.map((t) => t.id));
    for (const e of s.entries) ctx.ledger.add("production", e._id, `entry ${e.date}`);
    check(s.entries.length === 2 && s.entries.every((e) => e.seasonId === s.s1.id), "the saved entries are not both in season S1");
    return pass(`season ${s.s1.id} revision ${rev0} -> ${rev1}`);
  }));
  const ids = () => s.teams.map((t) => t.id);
  if (s.entries) {
    out.push(await runTest("P6-1", `production save racing a season end-date change (${FIXTURE.rounds} rounds, not forced)`, async () => {
      const signatures = new Map();
      for (let r = 0; r < FIXTURE.rounds; r += 1) {
        const d = dayOf(ctx, 6 + r);
        const [save, upd] = await Promise.all([
          attempt(ctx.svc.production.saveDay(d, { rows: teamRows(4 + r), reason: FIXTURE.reasons.day }, actorOf(ctx))),
          attempt(ctx.svc.season.updateSeason(s.s1.id, { endDate: addDays(d, -1) }, actorOf(ctx))),
        ]);
        const sig = `save:${save.status}/update:${upd.status}`;
        signatures.set(sig, (signatures.get(sig) ?? 0) + 1);
        for (const x of [save, upd]) check(x.ok || [400, 409].includes(x.status), `unexpected ${x.status} from a racing operation: ${clean(x.error?.message)}`);
        check(!(save.ok && upd.ok), `round ${r + 1}: BOTH the save (${d}) and the season shrink succeeded; the entry would sit outside its season`);
        const season = await seasonDoc(ctx, s.s1.id);
        for (const e of await prodRows(ctx, ids())) if (e.seasonId === s.s1.id) check(inWindow(season, e.date), `round ${r + 1}: entry ${e.date} lies outside season S1 (${season.startDate}..${season.endDate})`);
        if (!upd.ok || season.endDate !== dayOf(ctx, 29)) await ctx.svc.season.updateSeason(s.s1.id, { endDate: dayOf(ctx, 29) }, actorOf(ctx)); // restore, so the next round starts the same
      }
      const hist = [...signatures].map(([k, v]) => `${k} x${v}`).join("; ");
      ctx.facts.p6Signatures = hist;
      return signatures.size > 1 ? pass(`no entry ended outside its season in ${FIXTURE.rounds} rounds. Outcomes: ${hist}`) : inconclusive(`no violation, but every round ended the same way (${hist}), so a real interleaving was not demonstrated`);
    }));

    out.push(await runTest("P6-2", "correct / delete racing a season close: each ends all-or-nothing, never half-applied", async () => {
      const [victim] = (await prodRows(ctx, ids())).filter((e) => e.date === s.day);
      const [correct, close] = await Promise.all([
        attempt(ctx.svc.production.correctEntry(String(victim._id), { date: s.day, newMaaps: 6, note: "ZZ", reason: FIXTURE.reasons.fix }, actorOf(ctx))),
        attempt(ctx.svc.season.updateSeason(s.s1.id, { status: "CLOSED" }, actorOf(ctx))),
      ]);
      for (const x of [correct, close]) check(x.ok || [400, 409].includes(x.status), `unexpected ${x.status}: ${clean(x.error?.message)}`);
      const after = await must(ctx, "production", { _id: String(victim._id) }, "production entry after the race");
      check(correct.ok ? after.numberOfMaaps === 6 : after.numberOfMaaps === victim.numberOfMaaps, `correction reported ${correct.ok ? "success" : correct.status} but the entry holds ${after.numberOfMaaps} maaps (was ${victim.numberOfMaaps})`);
      const season = await seasonDoc(ctx, s.s1.id);
      if (close.ok) check(season.status === "CLOSED", "the close reported success but the season is not closed");
      if (season.status !== "OPEN") await ctx.svc.season.updateSeason(s.s1.id, { status: "OPEN" }, actorOf(ctx));
      const [del, close2] = await Promise.all([
        attempt(ctx.svc.production.deleteEntry(String(victim._id), { reason: FIXTURE.reasons.del }, actorOf(ctx))),
        attempt(ctx.svc.season.updateSeason(s.s1.id, { status: "CLOSED" }, actorOf(ctx))),
      ]);
      for (const x of [del, close2]) check(x.ok || [400, 409].includes(x.status), `unexpected ${x.status}: ${clean(x.error?.message)}`);
      const gone = await must(ctx, "production", { _id: String(victim._id) }, "production entry after the delete race");
      check(del.ok ? gone.isDeleted === true : gone.isDeleted === false, `delete reported ${del.ok ? "success" : del.status} but isDeleted is ${gone.isDeleted}`);
      if ((await seasonDoc(ctx, s.s1.id)).status !== "OPEN") await ctx.svc.season.updateSeason(s.s1.id, { status: "OPEN" }, actorOf(ctx));
      return pass(`correct ${correct.ok ? "applied" : correct.status} / close ${close.ok ? "applied" : close.status}; delete ${del.ok ? "applied" : del.status} / close ${close2.ok ? "applied" : close2.status}`);
    }));

    out.push(await runTest("P6-3", "refused operations leave no residue (closed target season)", async () => {
      await ctx.svc.season.updateSeason(s.s2.id, { status: "CLOSED" }, actorOf(ctx));
      const live = (await prodRows(ctx, ids())).find((e) => e.date === s.day && e.isDeleted !== true) ?? (await prodRows(ctx, ids()))[0];
      const snap = async () => {
        const prod = (await ctx.read("production", {})).filter((r) => String(r._id) === String(live?._id));
        const seas = (await ctx.read("seasons", {})).filter((r) => [s.s1.id, s.s2.id].includes(String(r._id)));
        check(seas.length === 2, `expected both fixture seasons to be readable, found ${seas.length}`);
        check(!live || prod.length === 1, "the production entry under test is not readable");
        return [JSON.stringify(prod), JSON.stringify(seas)];
      };
      const before = await snap();
      const r1 = await attempt(ctx.svc.production.saveDay(dayOf(ctx, 31), { rows: teamRows(3), reason: FIXTURE.reasons.day }, actorOf(ctx)));
      check(!r1.ok && r1.status === 409, `save into a closed season: expected 409, got ${r1.ok ? "success" : r1.status}`);
      const r2 = live ? await attempt(ctx.svc.production.correctEntry(String(live._id), { date: dayOf(ctx, 31), newMaaps: 3, note: "ZZ", reason: FIXTURE.reasons.fix }, actorOf(ctx))) : { ok: false, status: 409 };
      check(!r2.ok && [400, 409].includes(r2.status), `moving an entry into a closed season: expected 409, got ${r2.ok ? "success" : r2.status}`);
      check(same(before, await snap()), "an entry or a season revision changed although the operations were refused");
      await ctx.svc.season.updateSeason(s.s2.id, { status: "OPEN" }, actorOf(ctx));
      return pass("both refused; entries and both season revisions unchanged. (Mid-transaction failure injection is verified on the fake database only.)");
    }));

    out.push(await runTest("P6-4", "final sweep: no live fixture entry lies outside its season", async () => {
      const seasons = new Map((await ctx.read("seasons", {})).filter((x) => [s.s1.id, s.s2.id].includes(String(x._id))).map((x) => [String(x._id), x]));
      const rows = await prodRows(ctx, ids());
      for (const e of rows) check(inWindow(seasons.get(e.seasonId), e.date), `entry ${String(e._id)} (${e.date}) is outside season ${e.seasonId}`);
      return pass(`${rows.length} live entr${rows.length === 1 ? "y" : "ies"} checked`);
    }));
  } else {
    for (const id of ["P6-1", "P6-2", "P6-3", "P6-4"]) out.push({ id, title: "not run", status: STATUS.SKIPPED, detail: "setup failed" });
  }
  // The tidy always runs when any fixture exists, even after a failed test: the failing evidence stays in the database (soft delete keeps every entry and its history).
  let tidy = { failures: [], log: [] };
  if (s.teams.length || s.s1 || s.s2) tidy = await tidyP6(ctx, s);
  out.push(await runTest("P6-T", "tidy with normal services: entries soft-deleted, workers INACTIVE, seasons CLOSED (in that order)", async () => {
    check(tidy.failures.length === 0, `tidy incomplete, NOTHING was retried or removed: ${tidy.failures.join("; ")}`);
    const seasonsNow = [];
    for (const x of [s.s1, s.s2].filter(Boolean)) seasonsNow.push((await must(ctx, "seasons", { _id: x.id }, "fixture season")).status);
    for (const t of s.teams) check((await must(ctx, "labours", { _id: t.id }, `worker ${t.id}`)).status === "INACTIVE", `${t.id} is not INACTIVE`);
    check(seasonsNow.every((x) => x === "CLOSED"), `seasons are ${seasonsNow.join(", ")}, expected CLOSED`);
    check(!s.teams.length || (await prodRows(ctx, ids())).length === 0, "live fixture entries remain");
    return pass(`${tidy.log.join("; ")}; ${s.teams.length} worker(s) INACTIVE; ${seasonsNow.length} season(s) CLOSED; no live fixture entry`);
  }));
  const n = s.teams.length;
  out.push(await runTest("P6-IMPACT", "permanent effect on Labour, Salary and Balance numbers (measured): counts move, money returns to its original values", async () => {
    const after = await measure(ctx);
    const moved = expectDeltas(base.measure, after, { "labours.total": n, "labours.inactive": n, "labours.patlavale": n, "balances.labours": n });
    const seq = (await labourSeq(ctx)) - base.seq;
    check(seq === n, `the labour id counter moved by ${seq}, expected ${n}`);
    return pass(`only these moved: ${moved.join(", ")}; labour id counter +${seq}. Earned, received, paid, outstanding and overpaid totals are back to their original values (delta 0, checked for every measured number)`);
  }));
  out.push(await runTest("P6-ISO", "isolation: no record outside this run's fixtures changed (D1/D2 fixtures, other seasons, other counters included)", async () => {
    check(base.snapshot === (await othersSnapshot(ctx)), "a record outside this run's fixtures (or a counter other than the labour id counter) changed");
    return pass("every other labour, rate, attendance, Maapvali, production, payment, season, settings and bill record and every other counter is identical before and after");
  }));
  return out;
};

// ---------------------------------------------------------------------------------------------------------------------------------
// P3: invoice numbering lock (permanent side effects, see the report)
const NUMBERING = ["prefix", "separator", "includeFinancialYear", "padding"];
const trailingDigits = (billNumber) => /(\d+)$/.exec(String(billNumber ?? ""))?.[1]?.length ?? 0;
const sumDelta = (a, b) => Object.keys({ ...a, ...b }).reduce((n, k) => n + ((b[k] ?? 0) - (a[k] ?? 0)), 0);

export const p3Phase = async (ctx) => {
  const out = [];
  const guard = await runTest("P3-LOCK", "no bills of an earlier run of this phase exist (a retry must not silently duplicate them)", async () => {
    const prior = (await ctx.read("bills", {})).filter((b) => String(b.customer?.name ?? "").startsWith(`${FIXTURE.prefix} R`)).map((b) => String(b._id));
    if (!prior.length) return pass("none found");
    if (ctx.flags.allowRerun) return pass(`${prior.length} earlier fixture bill(s); continuing only because --allow-rerun was given`);
    return inconclusive(`${prior.length} earlier fixture bill(s): ${prior.slice(0, 10).join(", ")}. Nothing was written; review them, then add --allow-rerun only if you really want more`);
  });
  out.push(guard);
  if (guard.status !== STATUS.PASS) return blocked(out, ["P3-1", "P3-5", "P3-2", "P3-3", "P3-4", "P3-6", "P3-7"]);
  const s = { drafts: [] };
  const settings = await ctx.svc.invoiceSettings.loadSettings();
  const draftBody = (label, items) => ({
    billDate: ctx.today,
    taxMode: settings.defaultTaxMode ?? "GST",
    customer: { name: nameOf(ctx, label), address: "ZZ test address", stateName: settings.stateName || "ZZ", stateCode: settings.stateCode || "27" },
    items: items ?? [{ particulars: "ZZ P1C test bricks", hsn: "6901", quantity: 1000, unit: settings.units?.[0] ?? "bricks", rate: 1, taxRate: (settings.allowedTaxRatesBp?.[0] ?? 500) / 100 }],
  });
  const newDraft = async (label, items) => {
    const d = await ctx.svc.bill.createDraft(draftBody(label, items), actorOf(ctx));
    ctx.ledger.add("bills", d.id, `draft ${label}`);
    s.drafts.push(d.id);
    return d;
  };
  const stateNow = async () => ({ doc: await settingsDoc(ctx), bills: await lockingBills(ctx), counters: await countersMap(ctx) });
  const start = await stateNow();
  const startLocked = start.doc?.numberingLocked === true || start.bills.length > 0;
  const startFlag = start.doc?.numberingLocked === true;

  out.push(await runTest("P3-1", "creating a draft does not lock numbering", async () => {
    if (startLocked) return inconclusive("numbering was already locked before this run, so 'drafts do not lock' cannot be shown");
    await newDraft("DRAFT-ONLY");
    const doc = await settingsDoc(ctx);
    check(doc?.numberingLocked !== true, "the lock flag was set by creating a draft");
    check(!(await ctx.svc.invoiceSettings.isNumberingLocked(await ctx.svc.invoiceSettings.loadSettings())), "numbering reports locked after only a draft");
    return pass("no lock after a draft");
  }));

  let raced = false;
  out.push(await runTest("P3-5", "first finalize racing a numbering change (single, not forced)", async () => {
    if (!ctx.flags.numberingRace) return skipped("needs --accept-numbering-race: if the change wins it permanently alters the numbering of the test database");
    if (startLocked) return inconclusive("numbering was already locked, so the pre-lock race cannot be shown");
    const d = await newDraft("RACE");
    const cur = settings.numbering;
    const newPadding = cur.padding === 5 ? 4 : 5;
    const before = await countersMap(ctx);
    raced = true;
    const [fin, chg] = await Promise.all([
      attempt(ctx.svc.bill.finalizeBill(d.id, { reviewed: true }, actorOf(ctx))),
      attempt(ctx.svc.invoiceSettings.updateSettings({ numbering: { padding: newPadding } }, actorOf(ctx))),
    ]);
    for (const x of [fin, chg]) check(x.ok || [400, 409].includes(x.status), `unexpected ${x.status}: ${clean(x.error?.message)}`);
    const doc = await settingsDoc(ctx);
    const bill = await must(ctx, "bills", { _id: d.id }, "finalized/raced bill");
    const used = sumDelta(before, await countersMap(ctx));
    if (fin.ok) {
      check(doc.numberingLocked === true, "a bill was finalized but the lock is not set");
      check(used === 1, `${used} invoice numbers were used by one finalize`);
      check(trailingDigits(bill.billNumber) === doc.numbering.padding, `bill ${bill.billNumber} does not use the padding now stored (${doc.numbering.padding}): old and new formats were mixed`);
    } else {
      check(bill.status === "DRAFT" && !bill.billNumber, "finalize failed but the bill is not an untouched draft");
      check(used === 0, `finalize failed but ${used} invoice number(s) were used`);
      check(doc?.numberingLocked !== true, "finalize failed but the lock was set");
    }
    if (chg.ok) check(fin.ok ? trailingDigits(bill.billNumber) === newPadding : doc.numbering.padding === newPadding, "numbering change reported success but is not what is stored");
    else check(doc?.numbering?.padding === cur.padding || doc?.numbering?.padding === undefined, "numbering change was refused but the padding changed");
    if (!fin.ok) s.drafts = s.drafts.filter((x) => x !== d.id).concat(d.id);
    return pass(`finalize ${fin.ok ? "succeeded" : fin.status}, numbering change ${chg.ok ? "succeeded" : chg.status}; consistent`);
  }));

  out.push(await runTest("P3-2", "the first finalize creates the lock", async () => {
    if (startLocked) return inconclusive("numbering was already locked before this run; no finalize was attempted (it would only add a bill)");
    if (raced && (await settingsDoc(ctx))?.numberingLocked === true) return pass("the lock was created by the race test's finalize (see P3-5)");
    const d = (await ctx.read("bills", { status: "DRAFT", isDeleted: false })).find((b) => s.drafts.includes(String(b._id))) ?? (await newDraft("FIRST-FINALIZE"));
    const id = String(d._id ?? d.id);
    const before = await countersMap(ctx);
    const r = await attempt(ctx.svc.bill.finalizeBill(id, { reviewed: true }, actorOf(ctx)));
    if (!r.ok && r.status === 400) {
      const doc = await settingsDoc(ctx);
      check(doc?.numberingLocked !== true && sumDelta(before, await countersMap(ctx)) === 0, "finalize failed with 400 but left a lock or used a number");
      return inconclusive("the bill is not ready to finalize (seller details incomplete). This harness never edits seller settings; the failed attempt left no lock and used no number");
    }
    check(r.ok, `finalize failed (${r.status}): ${clean(r.error?.message)}`);
    const doc = await settingsDoc(ctx);
    check(doc?.numberingLocked === true && doc.numberingLockedAt, "finalized but numberingLocked / numberingLockedAt are not stored");
    check(sumDelta(before, await countersMap(ctx)) === 1, "exactly one invoice number should have been used");
    ctx.ledger.add("bills", id, "FINALIZED (permanent)");
    return pass(`finalized ${r.value.billNumber ?? id}; lock stored`);
  }));

  out.push(await runTest("P3-3", "after the lock: every numbering field is refused (409); an unchanged copy is accepted without rewriting", async () => {
    const now = await stateNow();
    const locked = now.doc?.numberingLocked === true || now.bills.length > 0;
    if (!locked) return inconclusive("numbering is not locked, so post-lock behaviour cannot be tested (and no numbering change is ever tried on an unlocked database by this test)");
    const cur = (await ctx.svc.invoiceSettings.loadSettings()).numbering;
    const attempts = { prefix: `${cur.prefix ?? ""}Z`, separator: cur.separator === "-" ? "/" : "-", includeFinancialYear: !cur.includeFinancialYear, padding: (cur.padding ?? 4) === 9 ? 8 : (cur.padding ?? 4) + 1 };
    for (const f of NUMBERING) {
      const rev = (await settingsDoc(ctx))?.revision;
      const r = await attempt(ctx.svc.invoiceSettings.updateSettings({ numbering: { [f]: attempts[f] } }, actorOf(ctx)));
      check(!r.ok && r.status === 409, `changing ${f} after the lock: expected 409, got ${r.ok ? "success (NUMBERING CHANGED!)" : r.status}`);
      const doc = await settingsDoc(ctx);
      check(same(doc?.numbering, now.doc?.numbering) && doc?.revision === rev, `${f}: settings changed although the change was refused`);
    }
    const same1 = await attempt(ctx.svc.invoiceSettings.updateSettings({ numbering: { ...cur } }, actorOf(ctx)));
    check(same1.ok, `an unchanged numbering copy was refused (${same1.status})`);
    check(same((await settingsDoc(ctx))?.numbering ?? null, now.doc?.numbering ?? null), "an unchanged numbering copy altered the stored numbering");
    return pass("prefix, separator, financial-year choice and padding all refused with 409; unchanged copy accepted");
  }));

  out.push(await runTest("P3-4", "legacy state: finalized/cancelled bills lock numbering even without the flag", async () => {
    if (startFlag || start.bills.length === 0) return skipped("the starting state has no 'bills present, flag unset' combination to observe");
    check(await ctx.svc.invoiceSettings.isNumberingLocked(start.doc ?? settings), "bills exist and the flag is unset, but numbering reports unlocked");
    return pass(`${start.bills.length} locking bill(s) present, flag unset at the start, reported locked`);
  }));

  out.push(await runTest("P3-6", "a failed finalize uses no invoice number and leaves no lock", async () => {
    const d = await attempt(ctx.svc.bill.createDraft(draftBody("EMPTY-BILL", []), actorOf(ctx)));
    if (!d.ok) return inconclusive(`could not create a deliberately incomplete draft (${d.status})`);
    ctx.ledger.add("bills", d.value.id, "draft EMPTY-BILL");
    s.drafts.push(d.value.id);
    const before = await stateNow();
    const r = await attempt(ctx.svc.bill.finalizeBill(d.value.id, { reviewed: true }, actorOf(ctx)));
    if (r.ok) return inconclusive("the incomplete draft was finalized (an unexpected bill now exists); the failure path could not be exercised");
    check(r.status === 400, `expected 400 (not ready), got ${r.status}`);
    const after = await stateNow();
    check(sumDelta(before.counters, after.counters) === 0, "a failed finalize used an invoice number");
    check(same(before.doc, after.doc), "a failed finalize changed the settings document (partial lock)");
    check((await must(ctx, "bills", { _id: d.value.id }, "failed bill")).status === "DRAFT", "the failed bill is no longer a draft");
    return pass("400; counters, settings and bill unchanged");
  }));

  out.push(await runTest("P3-7", "tidy up: discard the harness's unused drafts (soft delete)", async () => {
    let n = 0;
    for (const id of s.drafts) {
      const b = await must(ctx, "bills", { _id: id }, `draft bill ${id}`);
      if (b.status === "DRAFT" && b.isDeleted !== true) {
        await ctx.svc.bill.discardDraft(id, { reason: "ZZ P1C verify tidy" }, actorOf(ctx));
        n += 1;
      }
    }
    return pass(`${n} draft(s) soft-discarded; finalized bills and the lock cannot be undone`);
  }));
  return out;
};

export const PHASE_RUNNERS = Object.freeze({ precheck: precheckPhase, d1: d1Phase, d2: d2Phase, p6: p6Phase, p3: p3Phase });

/** Builds the gated context a phase runs with. `deps`: { services, read, toObjectId, insertLegacyLabour, probeTransaction, onRecord, today, runId, runNumber, settingsId }. */
const LABOUR_ID = /^L-\d{3,}$/; // same shape as the app's LABOUR_ID_PATTERN
const DIRECT_KEYS = ["_id", "labourType", "name", "mobile", "village", "joiningDate", "status"];
export const makeContext = (phase, deps, { windowStart, flags = {} }) => {
  if (!PHASES.includes(phase)) throw new Error(`unknown phase "${phase}"`);
  const writes = WRITE_PHASES.includes(phase);
  const read = gateRead(deps.read, deps.toObjectId);
  const ctx = {
    svc: gateServices(deps.services, { allowWrites: writes }),
    read,
    directInserts: 0,
    // The ONLY direct database write in the whole harness: one rate-less Bigari fixture, d2 phase, explicit flag, never over an existing record.
    // Reserves the next normal labour id (L-nnn) with the APPLICATION'S OWN allocator, so the counter and the id can never disagree and no later
    // real worker can receive the same id. One per run, d2 + explicit flag only. Same guarantee as createLabour: atomic $inc, a failure afterwards leaves a gap, never a duplicate.
    reserveLabourId: async () => {
      if (phase !== "d2" || !flags.directInsert) throw new WriteRefused("labour id reservation");
      if (ctx.reservedLabourId) throw new WriteRefused("a second labour id reservation");
      const id = await ctx.svc.labour.nextLabourId();
      if (!LABOUR_ID.test(String(id))) throw new WriteRefused("a reserved id that is not a normal labour id");
      ctx.reservedLabourId = String(id);
      return ctx.reservedLabourId;
    },
    insertLegacyLabour: async (doc) => {
      if (phase !== "d2" || !flags.directInsert) throw new WriteRefused("direct fixture insert");
      if (ctx.directInserts >= 1) throw new WriteRefused("a second direct fixture insert");
      const exact = Object.keys(doc).length === DIRECT_KEYS.length && DIRECT_KEYS.every((k) => k in doc);
      if (!exact || !ctx.reservedLabourId || doc._id !== ctx.reservedLabourId || !LABOUR_ID.test(String(doc._id)) || !new RegExp(`^${FIXTURE.prefix} R\\d{1,4} D2-NORATE$`).test(String(doc.name)) || doc.labourType !== "BIGARI") throw new WriteRefused("direct insert of a non-fixture document");
      const clash = [...(await read("labours", { _id: doc._id })), ...(await read("labours", { mobile: doc.mobile }))];
      if (clash.length) throw new WriteRefused("collision: that id or mobile already exists");
      ctx.directInserts += 1;
      ctx.fixtureLabours.add(String(doc._id));
      return deps.insertLegacyLabour(doc);
    },
    probeTransaction: deps.probeTransaction,
    ledger: createLedger(deps.onRecord), facts: {}, flags, windowStart, settingsId: deps.settingsId ?? "default",
    today: deps.today, runId: deps.runId, runNumber: deps.runNumber ?? 0,
    fixtureLabours: new Set(), fixtureSeasons: new Set(),
  };
  return ctx;
};

export const runPhase = async (phase, deps, options) => {
  const ctx = makeContext(phase, deps, options);
  const results = await PHASE_RUNNERS[phase](ctx);
  return { phase, results, ledger: ctx.ledger.rows(), verdict: verdict(results), facts: ctx.facts };
};

export const formatReport = (run, { dbName, host, windowStart } = {}) => {
  const lines = [`Phase 1C Stage 4 - phase ${run.phase} - target ${dbName}@${host}${windowStart ? ` - window ${windowStart}` : ""}`];
  for (const r of run.results) lines.push(`  [${r.status}] ${r.id} ${r.title}${r.detail ? `: ${r.detail}` : ""}`);
  if (run.ledger.length) {
    lines.push("Test records created (none can be removed by this tool):");
    for (const l of run.ledger) lines.push(`  ${l.collection}: ${l.id} - ${l.note}`);
  }
  const names = ["PASS", "FAIL", "INCONCLUSIVE", "SKIPPED"].map((k) => `${k} ${run.results.filter((r) => r.status === k).length}`);
  lines.push(`Result: ${names.join(", ")} -> exit ${run.verdict}. Real-MongoDB result for this phase only; other phases are separate.`);
  return lines;
};
