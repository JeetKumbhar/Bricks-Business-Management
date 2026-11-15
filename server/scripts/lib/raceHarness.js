// Race-condition harness for the Maapvali batch save (PUT /api/maap-entries/day/:date).
//
// It proves, against a real replica-set database (Atlas TEST) or against the in-memory fake used by the unit tests, that when a
// competing correction COMMITS after the batch has read its rows but BEFORE the batch makes its revision-guarded write:
//   - the batch answers HTTP 409 "Nothing was saved",
//   - no other row of the batch remains,
//   - the rival's committed change is kept untouched.
//
// This module is PURE ORCHESTRATION. It imports nothing: no mongoose, no config, no environment. Everything it touches is passed
// in (`deps`), so it cannot open a database connection by itself. The Atlas runner (../verifyRace.js) wires real dependencies in
// only after every safety guard passed; the unit test wires in the in-memory fake and a mongoose.connect that throws.
//
// deps:
//   api(method, path, body)        -> { status, body }        real HTTP against the application
//   MaapEntry                      the model object whose updateOne is observed (the very object the services use)
//   readLabours(filter)            -> rows     independent read (not through the observed model)
//   readRates(labourId)            -> rows
//   readEntries({ labourId, date }) -> rows    ALL states (live and deleted); a majority read on Atlas
//   today()                        -> "YYYY-MM-DD"
//   onRivalCommitted()             optional    (the fake database needs to be told the rival's write is committed)
//   log(line)                      optional
//
// Result classification (never PASS unless every required check ran and held):
//   PASS          every required check for every case ran and held
//   FAIL          the race was really created, but the outcome was wrong (status, message, counts, retries, final data)
//   INCONCLUSIVE  the race was NOT created or the run could not finish (hook never fired, rival failed, watchdog timeout,
//                 seed problem, date already used, case not run). Nothing is proven either way.
//   REFUSED       a safety guard, the read-only preflight (fixture collision or a used case date) or an unsafe index setting stopped
//                 the run BEFORE its first write

export const FIXTURE = Object.freeze({
  rateRupees: 100,
  ratePaise: 10000,
  workers: Object.freeze({ X: { name: "ZZ RACE X", mobile: "9000000201" }, Y: { name: "ZZ RACE Y", mobile: "9000000202" } }),
  joiningDate: "2026-11-01",
  defaultDates: Object.freeze(["2026-11-12", "2026-11-11", "2026-11-10"]), // R1, R2, R3
  reasons: Object.freeze({ seed: "ZZ RACE seed", batch: "ZZ RACE batch", rival: "ZZ RACE rival" }),
});
export const AMOUNTS = Object.freeze({ seed: 41, rival: 50, batchX: 42, batchY: 5 });
// Maapvali pay: maaps / 4 x rate per 4 maaps, nothing rounded down. 41 -> 1025, 50 -> 1250, 42 -> 1050, 5 -> 125 (rupees).
export const PAISE = Object.freeze({ seed: 102500, rival: 125000, batchX: 105000, batchY: 12500 });

// Request bodies. They are checked against the REAL Zod schemas in the unit test (saveDaySchema, correctionSchema).
// The correction schema requires `reason` and at least one of date / numberOfMaaps / note: `date` is NOT mandatory.
export const bodies = {
  createWorker: (key, joiningDate) => ({
    labourType: "MAAPVALI",
    name: FIXTURE.workers[key].name,
    mobile: FIXTURE.workers[key].mobile,
    village: "Test",
    joiningDate,
    ratePerFourMaaps: FIXTURE.rateRupees,
  }),
  seed: (ids) => ({ reason: FIXTURE.reasons.seed, rows: [{ labourId: ids.X, maaps: AMOUNTS.seed }] }),
  batch: (order, ids) => ({ reason: FIXTURE.reasons.batch, rows: order.map((k) => ({ labourId: ids[k], maaps: k === "X" ? AMOUNTS.batchX : AMOUNTS.batchY })) }),
  rival: () => ({ numberOfMaaps: AMOUNTS.rival, reason: FIXTURE.reasons.rival }),
};

export const CASES = Object.freeze([
  Object.freeze({
    id: "R1", dateIndex: 0, order: ["Y", "X"], rival: true, conflictField: "rows.1.labourId",
    // new row first, so the transaction's snapshot may predate the rival: either one write-conflict retry, or a direct mismatch
    sequences: [["upsert", "guarded"], ["upsert", "guarded", "upsert", "guarded"]],
  }),
  Object.freeze({ id: "R2", dateIndex: 1, order: ["X", "Y"], rival: true, conflictField: "rows.0.labourId", sequences: [["guarded", "upsert"]] }),
  Object.freeze({ id: "R3", dateIndex: 2, order: ["Y", "X"], rival: false, conflictField: null, sequences: [["upsert", "guarded"]] }),
]);

const REQUIRED = Object.freeze({
  race: ["rivalFiredOnce", "rivalPatch200", "rivalRev2Committed", "eventOrder", "rivalPassedThroughOnce", "rivalRequestsOne", "opSequence", "retryCounts", "batchHttp409", "batchMessage", "conflictField", "yHasNoEntry", "xSingleEntry", "xRivalState", "hookRestored"],
  control: ["hookNeverArmed", "noRivalRequests", "batchHttp200", "savedCounts", "opSequence", "retryCounts", "xState", "yState", "hookRestored"],
});

export const EXIT_CODES = Object.freeze({ PASS: 0, FAIL: 1, REFUSED: 2, INCONCLUSIVE: 3 });

// ---------- Guards for the Atlas runner (pure, so they can be unit tested without any connection) ----------

export const parseDbName = (uri = "") => String(uri).match(/^mongodb(?:\+srv)?:\/\/[^/]+\/([^/?#]*)/i)?.[1] ?? "";
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export const parseDates = (value) => {
  if (value === undefined) return { dates: [...FIXTURE.defaultDates] };
  const dates = String(value).split(",").map((d) => d.trim());
  if (dates.length !== 3 || !dates.every((d) => DATE.test(d)) || new Set(dates).size !== 3) return { problem: "--dates needs exactly three different dates (R1,R2,R3) like 2026-11-12,2026-11-11,2026-11-10" };
  return { dates };
};

/** Returns { ok: true, dbName, dates } or { ok: false, problem }. Prints nothing, connects to nothing, never includes the URI. */
export const checkAtlasGuards = ({ argv = [], env = {} } = {}) => {
  const opt = (name) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const refuse = (problem) => ({ ok: false, problem: `Refusing: ${problem}` });
  if (opt("mode") !== "atlas") return refuse("add --mode atlas. (The mocked checks run with: npx vitest run tests/raceHarness.test.js; they never connect to a database.)");
  if (!argv.includes("--i-understand-this-writes-test-data")) return refuse("add --i-understand-this-writes-test-data (this run creates test workers and entries in the TEST database).");
  if (String(env.NODE_ENV ?? "").toLowerCase() === "production") return refuse("NODE_ENV is production. This script only works on a TEST database.");
  const dbName = parseDbName(env.MONGODB_URI);
  if (!dbName) return refuse("MONGODB_URI has no database name. Use a TEST database whose name ends with _test.");
  if (!/_test$/i.test(dbName)) return refuse(`the database name "${dbName}" does not end with "_test". This script only works on a TEST database.`);
  if (opt("confirm-db") !== dbName) return refuse(`add --confirm-db ${dbName} to confirm that "${dbName}" is the TEST database you mean.`);
  if (!env.OWNER_EMAIL || !env.OWNER_PASSWORD) return refuse("set OWNER_EMAIL and OWNER_PASSWORD (the TEST owner; the password is never printed).");
  const parsed = parseDates(opt("dates"));
  if (parsed.problem) return refuse(parsed.problem);
  return { ok: true, dbName, dates: parsed.dates };
};

// ---------- Index safety and cleanup helpers (pure: the mongoose object / server are passed in) ----------

/** Why the run must refuse, or null. Mongoose builds indexes and creates collections when a MODEL is defined, if these are not false. */
export const indexSafetyProblem = (mongooseLike) => {
  const bad = ["autoIndex", "autoCreate"].filter((key) => mongooseLike.get(key) !== false);
  return bad.length ? `Refusing: Mongoose ${bad.join(" and ")} ${bad.length === 1 ? "is" : "are"} not false, so loading the models could build indexes or create collections in the TEST database. Nothing was written.` : null;
};

/**
 * Switches both off and reports any that did not take effect. Must run AFTER config/db.js is imported (that module sets
 * autoIndex = !isProduction when it loads) and BEFORE the app or any model is imported.
 */
export const applyIndexSafety = (mongooseLike) => {
  mongooseLike.set("autoIndex", false);
  mongooseLike.set("autoCreate", false);
  return indexSafetyProblem(mongooseLike);
};

/** Stops listening AND destroys active connections (a request stuck in a retry loop would otherwise keep close() waiting). Never throws. */
export const shutdownServer = async (server) => {
  if (!server) return;
  const closed = new Promise((resolve) => {
    try {
      server.close(() => resolve());
    } catch {
      resolve();
    }
  });
  try {
    server.closeAllConnections?.();
  } catch {
    /* already closed */
  }
  await closed;
};

// ---------- Preflight (READ-ONLY) and fixtures: create-only, collision-safe, never updates or deletes ----------

const sameId = (a, b) => String(a) === String(b);

/** Read-only look at one fixture worker: absent, usable as it is, or a collision. Never writes. */
const inspectWorker = async (deps, key, earliestDate) => {
  const spec = FIXTURE.workers[key];
  const byMobile = await deps.readLabours({ mobile: spec.mobile });
  const byName = await deps.readLabours({ name: spec.name });
  if (!byMobile.length && !byName.length) return { state: "absent" };
  const one = byMobile[0];
  const consistent = byMobile.length === 1 && byName.length === 1 && sameId(one._id, byName[0]._id);
  if (!consistent) return { state: "collision", reason: `COLLISION: mobile ${spec.mobile} or name "${spec.name}" already belongs to a different worker` };
  if (one.labourType !== "MAAPVALI" || one.status !== "ACTIVE") return { state: "collision", reason: `COLLISION: ${spec.name} exists but is not an ACTIVE Maapvali worker` };
  if (one.joiningDate > earliestDate) return { state: "collision", reason: `COLLISION: ${spec.name} joined on ${one.joiningDate}, after the earliest case date ${earliestDate}; choose later --dates` };
  const rates = await deps.readRates(String(one._id));
  if (rates.length !== 1 || rates[0].ratePaise !== FIXTURE.ratePaise) {
    return { state: "collision", reason: `COLLISION: ${spec.name} must have exactly one rate row of ${FIXTURE.ratePaise} paise; found ${rates.length} row(s)` };
  }
  return { state: "usable", id: String(one._id) };
};

/**
 * The complete read-only pre-scan. It runs BEFORE the first write of the whole run (no worker, no entry, nothing):
 *   1. both fixture workers, by mobile AND by name: absent, or exactly the expected ACTIVE Maapvali worker with its one 100-rate row
 *   2. ALL three case dates for BOTH workers (live and deleted entries): every date must be unused
 * Any collision or used date refuses the ENTIRE run. Returns { refused, reason } or { plan: { X, Y } }.
 */
export const preflight = async (deps, dates, earliestDate) => {
  const plan = {};
  const problems = [];
  for (const key of ["X", "Y"]) {
    plan[key] = await inspectWorker(deps, key, earliestDate);
    if (plan[key].state === "collision") problems.push(plan[key].reason);
  }
  for (const key of ["X", "Y"]) {
    if (plan[key].state !== "usable") continue; // an absent worker cannot have entries yet
    for (const date of dates) {
      const used = await deps.readEntries({ labourId: plan[key].id, date });
      if (used.length) problems.push(`DATE_USED: ${FIXTURE.workers[key].name} already has ${used.length} entr${used.length === 1 ? "y" : "ies"} (live or deleted) on ${date}`);
    }
  }
  if (problems.length) return { refused: true, reason: `${problems.join("; ")}. Nothing was written; choose other --dates or resolve the collision.` };
  return { plan };
};

/** Creates only the workers the pre-scan found absent (through the real API). Called only after a clean preflight. */
const ensureFixtures = async (deps, plan, joiningDate, log) => {
  const ids = {};
  const created = [];
  const reused = [];
  for (const key of ["X", "Y"]) {
    const spec = FIXTURE.workers[key];
    if (plan[key].state === "usable") {
      ids[key] = plan[key].id;
      reused.push(key);
      log?.(`fixture: reusing existing ${spec.name} (${ids[key]})`);
      continue;
    }
    const res = await deps.api("post", "/api/labours", bodies.createWorker(key, joiningDate));
    if (res.status !== 201 || !res.body?.data?.id) return { inconclusive: true, reason: `creating ${spec.name} returned HTTP ${res.status}` };
    ids[key] = String(res.body.data.id);
    created.push(key);
    log?.(`fixture: created ${spec.name} as ${ids[key]}`);
    const rates = await deps.readRates(ids[key]);
    if (rates.length !== 1 || rates[0].ratePaise !== FIXTURE.ratePaise) return { inconclusive: true, reason: `${spec.name} must have exactly one rate row of ${FIXTURE.ratePaise} paise; found ${rates.length} row(s)` };
  }
  return { ids, created, reused };
};

// ---------- The observation hook on MaapEntry.updateOne ----------

const opKind = (filter, options) => {
  if (filter && filter._id !== undefined && filter.revision !== undefined) return "guarded";
  if (options?.upsert === true) return "upsert";
  return "other";
};

/**
 * Wraps model.updateOne. States: DISARMED (control: observes and counts only, can never fire), ARMED, FIRING, DONE.
 * It fires only for the batch's OWN guarded update: a session is present, the filter targets X's entry id with revision 1.
 * It goes to FIRING before the rival runs, so the rival's own updateOne (no session) passes straight through (never intercepted).
 */
const installHook = (deps, { xEntryId, rival, events, clock }) => {
  const model = deps.MaapEntry;
  const ownDescriptor = Object.getOwnPropertyDescriptor(model, "updateOne");
  const original = model.updateOne;
  const hook = { state: rival ? "ARMED" : "DISARMED", fireCount: 0, passedThroughWhileFiring: 0, ops: [], unsessioned: 0, rivalProblem: null };

  model.updateOne = async function observedUpdateOne(filter, update, options) {
    const kind = opKind(filter, options);
    const inBatch = Boolean(options?.session);
    if (inBatch) hook.ops.push(kind);
    else hook.unsessioned += 1;
    if (hook.state === "FIRING" && !inBatch) hook.passedThroughWhileFiring += 1; // the rival's own write: never intercepted
    const isTarget = hook.state === "ARMED" && inBatch && kind === "guarded" && sameId(filter._id, xEntryId) && filter.revision === 1;
    if (isTarget) {
      hook.state = "FIRING"; // BEFORE the rival runs: its own updateOne can no longer match
      try {
        await rival();
      } finally {
        hook.state = "DONE";
        hook.fireCount += 1;
      }
      events.push({ name: "guarded-invoked", at: clock() });
    }
    return original.apply(model, [filter, update, options]);
  };

  const uninstall = () => {
    if (ownDescriptor) Object.defineProperty(model, "updateOne", ownDescriptor);
    else delete model.updateOne;
    return model.updateOne === original;
  };
  return { hook, uninstall };
};

const inOrder = (events, names) => {
  let from = -1;
  for (const name of names) {
    const at = events.findIndex((e, i) => i > from && e.name === name);
    if (at < 0) return false;
    from = at;
  }
  return true;
};

const withWatchdog = (promise, ms) =>
  new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ timedOut: true }), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve({ value }); },
      (error) => { clearTimeout(timer); resolve({ error }); }
    );
  });

const sameSequence = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

// ---------- One case ----------

export const runCase = async (deps, spec, { date, ids, watchdogMs = 30000 }) => {
  const clock = deps.now ?? (() => performance.now());
  const t0 = clock();
  const events = [];
  const mark = (name) => events.push({ name, at: clock() });
  const res = { id: spec.id, date, verdict: "INCONCLUSIVE", checks: {}, fails: [], inconclusive: [], notes: [], events, ops: [], counts: null, stopRun: false };
  const check = (name, condition, detail) => {
    res.checks[name] = Boolean(condition);
    if (!condition) res.fails.push(`${name}: ${detail}`);
  };
  const finish = () => {
    const required = REQUIRED[spec.rival ? "race" : "control"];
    const missing = required.filter((name) => !(name in res.checks));
    if (res.inconclusive.length) res.verdict = "INCONCLUSIVE";
    else if (res.fails.length) res.verdict = "FAIL";
    else if (missing.length) {
      res.verdict = "INCONCLUSIVE";
      res.inconclusive.push(`CHECKS_SKIPPED: ${missing.join(", ")}`);
    } else res.verdict = "PASS";
    res.events = events.map((e) => ({ name: e.name, ms: Math.round(e.at - t0) }));
    return res;
  };
  const inconclusive = (why) => {
    res.inconclusive.push(why);
    return finish();
  };

  const dayUrl = `/api/maap-entries/day/${date}`;
  let patchRequests = 0;
  const api = (method, path, body) => {
    if (String(method).toLowerCase() === "patch") patchRequests += 1;
    return deps.api(method, path, body);
  };

  // 1. the date must be unused by both workers (live or deleted rows): this harness never overwrites or deletes anything
  for (const key of ["X", "Y"]) {
    const used = await deps.readEntries({ labourId: ids[key], date });
    if (used.length) return inconclusive(`DATE_USED: ${key} already has ${used.length} entr${used.length === 1 ? "y" : "ies"} on ${date}. Nothing was run on this date; choose other --dates.`);
  }

  // 2. seed: X gets 41 maaps (a backdated save needs a reason)
  const seed = await api("put", dayUrl, bodies.seed(ids));
  if (seed.status !== 200 || seed.body?.data?.saved?.created !== 1) return inconclusive(`SEED_FAILED: HTTP ${seed.status}`);
  const [seeded, ...extra] = await deps.readEntries({ labourId: ids.X, date });
  if (!seeded || extra.length || seeded.numberOfMaaps !== AMOUNTS.seed || seeded.revision !== 1 || seeded.earningsPaise !== PAISE.seed || seeded.isDeleted) {
    return inconclusive("SEED_STATE: X's seeded entry is not exactly 41 maaps / revision 1 / 102500 paise");
  }
  const xEntryId = String(seeded._id);

  // 3. the rival (race cases only): a real PATCH that commits on its own, verified BEFORE the batch's guarded write is allowed on
  const rival = spec.rival
    ? async () => {
        mark("rival-start");
        const patch = await api("patch", `/api/maap-entries/${xEntryId}`, bodies.rival());
        mark("rival-http");
        if (patch.status !== 200) return void (res.inconclusive.push(`RIVAL_HTTP_${patch.status}: the rival correction did not return 200, so the race was not created`));
        res.checks.rivalPatch200 = true;
        const rows = await deps.readEntries({ labourId: ids.X, date });
        const x = rows[0];
        const committed = rows.length === 1 && x.numberOfMaaps === AMOUNTS.rival && x.revision === 2 && (x.history ?? []).length === 1 && patch.body?.data?.revision === 2;
        if (!committed) return void (res.inconclusive.push("RIVAL_NOT_COMMITTED: an independent read did not show X at 50 maaps / revision 2 with one history entry"));
        res.checks.rivalRev2Committed = true;
        mark("rival-verified");
        await deps.onRivalCommitted?.();
      }
    : null;

  // 4. the batch, with the hook installed (control: hook observes only and is never armed)
  const { hook, uninstall } = installHook(deps, { xEntryId, rival, events, clock });
  patchRequests = 0;
  let batch;
  try {
    batch = await withWatchdog(api("put", dayUrl, bodies.batch(spec.order, ids)), watchdogMs);
  } finally {
    res.checks.hookRestored = uninstall();
    if (!res.checks.hookRestored) res.fails.push("hookRestored: MaapEntry.updateOne was not restored");
  }
  res.ops = hook.ops;
  const sequence = hook.ops.filter((k) => k === "upsert" || k === "guarded");
  res.counts = { upsert: sequence.filter((k) => k === "upsert").length, guarded: sequence.filter((k) => k === "guarded").length, passedThroughWhileFiring: hook.passedThroughWhileFiring };

  if (batch.timedOut) {
    res.stopRun = true;
    return inconclusive(`WATCHDOG: the batch did not answer within ${watchdogMs} ms; its final state is uncertain, so no further case is run`);
  }
  if (batch.error) return inconclusive(`REQUEST_ERROR: the batch request threw (${batch.error?.name ?? "error"})`);
  const reply = batch.value;

  // 5. was the race really created?
  if (spec.rival) {
    if (hook.fireCount !== 1) res.inconclusive.push(`HOOK_NOT_FIRED: the batch's guarded update was intercepted ${hook.fireCount} times (expected exactly 1); the race was not created`);
    if (res.inconclusive.length) return finish();
    check("rivalFiredOnce", hook.fireCount === 1, "hook fired a different number of times");
  } else {
    check("hookNeverArmed", hook.state === "DISARMED" && hook.fireCount === 0, `state=${hook.state}, fired=${hook.fireCount}`);
    check("noRivalRequests", patchRequests === 0 && hook.unsessioned === 0, `patchRequests=${patchRequests}, writes outside the batch=${hook.unsessioned}`);
  }

  // 6. outcome
  const retriesOk = spec.sequences.some((allowed) => sameSequence(allowed, sequence));
  check("opSequence", retriesOk, `observed [${sequence.join(", ")}], allowed ${spec.sequences.map((s) => `[${s.join(", ")}]`).join(" or ")}`);
  check("retryCounts", res.counts.upsert <= 2 && res.counts.guarded <= 2 && retriesOk, `upsert ${res.counts.upsert}, guarded ${res.counts.guarded}: unexpected number of transaction attempts`);

  const xRows = await deps.readEntries({ labourId: ids.X, date });
  const yRows = await deps.readEntries({ labourId: ids.Y, date });
  const x = xRows[0];
  const y = yRows[0];

  if (spec.rival) {
    check("eventOrder", inOrder(events, ["rival-start", "rival-http", "rival-verified", "guarded-invoked"]), `events: ${events.map((e) => e.name).join(" > ")}`);
    check("rivalPassedThroughOnce", hook.passedThroughWhileFiring === 1, `the rival's own updateOne passed through ${hook.passedThroughWhileFiring} times (expected 1)`);
    check("rivalRequestsOne", patchRequests === 1, `${patchRequests} PATCH requests (expected 1)`);
    check("batchHttp409", reply.status === 409, `HTTP ${reply.status}`);
    check("batchMessage", String(reply.body?.message ?? "").includes("Nothing was saved"), `message: ${reply.body?.message}`);
    check("conflictField", JSON.stringify(reply.body ?? {}).includes(spec.conflictField), `no "${spec.conflictField}" in the response`);
    check("yHasNoEntry", yRows.length === 0, `Y has ${yRows.length} entr${yRows.length === 1 ? "y" : "ies"} on ${date} (live or deleted); the batch's new row was not rolled back`);
    check("xSingleEntry", xRows.length === 1, `X has ${xRows.length} entries`);
    const h = x?.history ?? [];
    check(
      "xRivalState",
      x && x.numberOfMaaps === AMOUNTS.rival && x.revision === 2 && x.earningsPaise === PAISE.rival && !x.isDeleted && h.length === 1 && h[0].reason === FIXTURE.reasons.rival && h[0].before?.numberOfMaaps === AMOUNTS.seed,
      `X = ${x?.numberOfMaaps} maaps, revision ${x?.revision}, ${h.length} history entries (expected the rival's 50 / 2 / 1, not the batch's 42)`
    );
  } else {
    check("batchHttp200", reply.status === 200, `HTTP ${reply.status}`);
    const saved = reply.body?.data?.saved;
    check("savedCounts", saved?.created === 1 && saved?.updated === 1 && saved?.unchanged === 0, `saved=${JSON.stringify(saved)}`);
    const h = x?.history ?? [];
    check(
      "xState",
      xRows.length === 1 && x.numberOfMaaps === AMOUNTS.batchX && x.revision === 2 && x.earningsPaise === PAISE.batchX && h.length === 1 && h[0].reason === FIXTURE.reasons.batch && h[0].before?.numberOfMaaps === AMOUNTS.seed,
      `X = ${x?.numberOfMaaps} maaps, revision ${x?.revision}, ${h.length} history entries (expected 42 / 2 / 1)`
    );
    check(
      "yState",
      yRows.length === 1 && y.numberOfMaaps === AMOUNTS.batchY && y.revision === 1 && y.earningsPaise === PAISE.batchY && y.ratePaise === FIXTURE.ratePaise && !y.isDeleted,
      `Y = ${y?.numberOfMaaps} maaps, revision ${y?.revision} (expected 5 / 1)`
    );
  }
  return finish();
};

// ---------- The whole run ----------

const overall = (cases) => {
  if (cases.some((c) => c.verdict === "FAIL")) return "FAIL";
  if (cases.some((c) => c.verdict === "INCONCLUSIVE")) return "INCONCLUSIVE";
  return cases.length === CASES.length && cases.every((c) => c.verdict === "PASS") ? "PASS" : "INCONCLUSIVE";
};

export const runRace = async (deps, opts = {}) => {
  const dates = opts.dates ?? [...FIXTURE.defaultDates];
  const joiningDate = opts.joiningDate ?? FIXTURE.joiningDate;
  const watchdogMs = opts.watchdogMs ?? 30000;
  const log = deps.log;
  const today = deps.today();
  const dateProblem =
    dates.length !== CASES.length || new Set(dates).size !== dates.length
      ? "three different case dates are needed"
      : dates.find((d) => !DATE.test(d) || d >= today)
        ? `every case date must be a past date (before ${today})`
        : dates.find((d) => d < joiningDate)
          ? `no case date may be before the workers' joining date ${joiningDate}`
          : null;
  if (dateProblem) return { verdict: "REFUSED", reason: dateProblem, cases: [] };

  const scan = await preflight(deps, dates, [...dates].sort()[0]); // read-only; refuses the whole run before the first write
  if (scan.refused) return { verdict: "REFUSED", reason: scan.reason, cases: [] };
  const fixtures = await ensureFixtures(deps, scan.plan, joiningDate, log);
  if (fixtures.inconclusive) return { verdict: "INCONCLUSIVE", reason: fixtures.reason, cases: [] };

  const cases = [];
  let stopped = null;
  for (const spec of CASES) {
    if (stopped) {
      cases.push({ id: spec.id, date: dates[spec.dateIndex], verdict: "INCONCLUSIVE", checks: {}, fails: [], inconclusive: [`NOT_RUN: ${stopped}`], events: [], ops: [], counts: null, notes: [] });
      continue;
    }
    const result = await runCase(deps, spec, { date: dates[spec.dateIndex], ids: fixtures.ids, watchdogMs });
    cases.push(result);
    log?.(`${spec.id}: ${result.verdict}`);
    if (result.stopRun) stopped = `${spec.id} left an uncertain state`;
  }
  return { verdict: overall(cases), reason: "", fixtures: { created: fixtures.created, reused: fixtures.reused, ids: fixtures.ids }, cases };
};

export const formatReport = (result) => {
  const lines = [];
  lines.push(`RESULT: ${result.verdict}${result.reason ? ` (${result.reason})` : ""}`);
  if (result.fixtures) lines.push(`Fixtures: created [${result.fixtures.created.join(", ")}], reused [${result.fixtures.reused.join(", ")}], ids ${JSON.stringify(result.fixtures.ids)}`);
  for (const c of result.cases) {
    lines.push(`- ${c.id} (${c.date}): ${c.verdict}`);
    if (c.ops?.length) lines.push(`    transaction ops: [${c.ops.join(", ")}]${c.counts ? `; upserts ${c.counts.upsert}, guarded updates ${c.counts.guarded}` : ""}`);
    if (c.events?.length) lines.push(`    events: ${c.events.map((e) => `${e.name}@${e.ms}ms`).join(" > ")}`);
    for (const f of c.fails ?? []) lines.push(`    FAILED CHECK ${f}`);
    for (const n of c.inconclusive ?? []) lines.push(`    INCONCLUSIVE ${n}`);
    const passed = Object.entries(c.checks ?? {}).filter(([, v]) => v).map(([k]) => k);
    if (passed.length) lines.push(`    checks passed: ${passed.join(", ")}`);
  }
  lines.push("Only a RESULT of PASS means every required check ran and held. Nothing is deleted; the test workers and entries stay in the TEST database.");
  return lines;
};
