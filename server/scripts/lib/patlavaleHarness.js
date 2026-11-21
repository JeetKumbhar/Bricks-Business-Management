// Patlavale production (P1-P5 + transaction/rollback "T") verification harness. PURE ORCHESTRATION: this module imports nothing,
// so importing it can never connect to or write to a database. Everything it touches is passed in (`deps`), which is what lets
// the SAME code run in two places:
//   - MOCKED: tests/patlavaleHarness.test.js, against the in-memory fake. Reports are labelled MOCKED and never say PASS.
//   - ATLAS:  scripts/verifyPatlavale.js, against the TEST database, only after explicit approval. Reports say PASS.
//
// It only ever CREATES new records (a test season, test teams, a non-Patlavale test worker, production entries, one payment) and
// corrects / soft-deletes ENTRIES IT CREATED ITSELF through the application's own API. It never updates, soft-deletes or hard-deletes
// anything that existed before the run, and never cleans up afterwards.

export const FIXTURE = Object.freeze({
  prefix: "ZZ PATLAVALE VERIFY",
  // Real, but not any existing labour: absent ids are verified by the preflight.
  unknownTeamId: "L-999999",
  teams: Object.freeze({
    A: Object.freeze({ name: "ZZ PATLAVALE VERIFY TEAM A", mobile: "9000000311", rate: 700 }),
    B: Object.freeze({ name: "ZZ PATLAVALE VERIFY TEAM B", mobile: "9000000312", rate: 700 }),
    C: Object.freeze({ name: "ZZ PATLAVALE VERIFY TEAM C", mobile: "9000000313", rate: 700 }),
    D: Object.freeze({ name: "ZZ PATLAVALE VERIFY TEAM D", mobile: "9000000314", rate: 700 }),
    E: Object.freeze({ name: "ZZ PATLAVALE VERIFY TEAM E", mobile: "9000000315", rate: 700.02 }), // rounding-boundary rate
  }),
  nonPatlavale: Object.freeze({ name: "ZZ PATLAVALE VERIFY MAAPVALI", mobile: "9000000316", labourType: "MAAPVALI", ratePerFourMaaps: 100 }),
  seasons: Object.freeze({
    s1: Object.freeze({ name: "ZZ PATLAVALE VERIFY SEASON 1", from: 0, to: 29 }),
    s2: Object.freeze({ name: "ZZ PATLAVALE VERIFY SEASON 2", from: 30, to: 59 }),
  }),
  noSeasonOffset: 75, // no season covers this day
  windowDays: 80, // the preflight requires the whole window [base, base+80] to be free of seasons and production entries
  joiningOffset: -30,
  defaultWindowStart: "2025-03-01",
  reasons: Object.freeze({ day: "ZZ PAT verify day", fix: "ZZ PAT verify correction", del: "ZZ PAT verify delete", rate: "ZZ PAT verify rate change", rival: "ZZ PAT verify rival" }),
});

export const EXIT_CODES = Object.freeze({ PASS: 0, FAIL: 1, REFUSED: 2, INCONCLUSIVE: 3 });
export const GROUPS = Object.freeze(["P1", "P2", "P3", "P4", "P5", "T"]);
export const MAX_TRANSACTION_OPS = 8; // "bounded retries": a guarded batch of two rows may never issue more write ops than this

// ---------- Small pure helpers ----------

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
export const isValidDate = (value) => {
  const m = typeof value === "string" ? DATE.exec(value) : null;
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
};
export const addDays = (date, n) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

/** Independent half-up calculation, written WITHOUT the production helpers: maaps / 4 x ratePaise, rounded once. */
export const expectedEarningsPaise = (maaps, ratePaise) => Math.floor((maaps * ratePaise + 2) / 4);
export const expectedPayable = (maaps) => maaps * 250;
export const expectedPhysical = (maaps) => maaps * 275;

const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const idOf = (row) => String(row._id);
const liveRows = (rows) => rows.filter((r) => !r.isDeleted);
const eachSecond = (rows) => rows.slice().sort((a, b) => idOf(a).localeCompare(idOf(b)));

/** The planned dates, all derived from the window start. Offsets are fixed so every test has a defined expected outcome. */
export const planDates = (base) => {
  const d = (n) => addDays(base, n);
  return {
    base,
    joining: d(FIXTURE.joiningOffset),
    windowEnd: d(FIXTURE.windowDays),
    s1: { name: FIXTURE.seasons.s1.name, startDate: d(FIXTURE.seasons.s1.from), endDate: d(FIXTURE.seasons.s1.to) },
    s2: { name: FIXTURE.seasons.s2.name, startDate: d(FIXTURE.seasons.s2.from), endDate: d(FIXTURE.seasons.s2.to) },
    p1: [d(0), d(1), d(2), d(3), d(4)],
    round: [d(5), d(6)],
    p2: { day: d(10), invalid: d(11), other: d(12) },
    p3: { before: d(15), later: d(16), rateChange: d(20), after: d(25) },
    p4: { move: d(13), target: d(14), future: null },
    p5: { closedOpenDay: d(30), closedTry: d(31), noSeason: d(FIXTURE.noSeasonOffset), payment: d(FIXTURE.noSeasonOffset), beforeJoining: d(FIXTURE.joiningOffset - 10) },
    t: { race: d(22), control: d(23) },
  };
};

export const parseWindowStart = (value) => {
  const v = value ?? FIXTURE.defaultWindowStart;
  return isValidDate(v) ? { base: v } : { problem: "--window-start must be a real date in YYYY-MM-DD form (for example 2025-03-01)" };
};

// ---------- Cluster / database guards (pure) ----------

export const EXPECTED_CLUSTER_HOST = "aayush-carting.7xmegwh.mongodb.net";
export const EXPECTED_CLUSTER_SUFFIX = ".7xmegwh.mongodb.net";
export const EXPECTED_DB = "aayush_carting_test";

export const parseDbName = (uri) => /^mongodb(?:\+srv)?:\/\/[^/]+\/([^/?#]*)/.exec(String(uri ?? ""))?.[1] || null;

/** Host list of a connection string, WITHOUT credentials or ports. Never returns anything secret. */
export const parseHosts = (uri) => {
  const m = /^(mongodb(?:\+srv)?):\/\/(?:[^@/]*@)?([^/?#]+)/.exec(String(uri ?? ""));
  if (!m) return null;
  return { srv: m[1] === "mongodb+srv", hosts: m[2].split(",").map((h) => h.replace(/:\d+$/, "").toLowerCase()) };
};

/** True when a host belongs to the confirmed cluster: the SRV name itself, or one of its shard hosts (same cluster domain). */
export const hostIsExpectedCluster = (host) => {
  const h = String(host ?? "").toLowerCase().replace(/:\d+$/, "");
  return h === EXPECTED_CLUSTER_HOST || h.endsWith(EXPECTED_CLUSTER_SUFFIX);
};

/** Pure guard for the Atlas runner. Returns { ok, dbName, host, base } or { ok: false, problem }. Prints nothing secret. */
export const checkAtlasGuards = ({ argv = [], env = {} } = {}) => {
  const opt = (name) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const refuse = (problem) => ({ ok: false, problem: `Refusing: ${problem}` });
  if (opt("mode") !== "atlas") return refuse("add --mode atlas. (The mocked checks run with: npx vitest run tests/patlavaleHarness.test.js; they never connect to a database.)");
  if (!argv.includes("--i-understand-this-writes-test-data")) return refuse("add --i-understand-this-writes-test-data (this run creates test teams, a season, entries and one payment in the TEST database).");
  if (String(env.NODE_ENV ?? "").toLowerCase() === "production") return refuse("NODE_ENV is production. This script only works on a TEST database.");
  const dbName = parseDbName(env.MONGODB_URI);
  if (!dbName) return refuse("MONGODB_URI has no database name.");
  if (dbName !== EXPECTED_DB) return refuse(`the database name is "${dbName}", but this script is only for "${EXPECTED_DB}".`);
  if (opt("confirm-db") !== EXPECTED_DB) return refuse(`add --confirm-db ${EXPECTED_DB}.`);
  const parsed = parseHosts(env.MONGODB_URI);
  if (!parsed) return refuse("MONGODB_URI could not be read (host missing).");
  const wrong = parsed.hosts.filter((h) => !hostIsExpectedCluster(h));
  if (wrong.length) return refuse(`the cluster host in MONGODB_URI is not the confirmed TEST cluster ${EXPECTED_CLUSTER_HOST}.`);
  if (opt("confirm-host") !== EXPECTED_CLUSTER_HOST) return refuse(`add --confirm-host ${EXPECTED_CLUSTER_HOST} to confirm that this is the TEST cluster you mean.`);
  if (!env.OWNER_EMAIL || !env.OWNER_PASSWORD) return refuse("set OWNER_EMAIL and OWNER_PASSWORD (the TEST owner; the password is never printed).");
  const window = parseWindowStart(opt("window-start"));
  if (window.problem) return refuse(window.problem);
  return { ok: true, dbName, host: EXPECTED_CLUSTER_HOST, base: window.base };
};

/** Why the run must refuse after connecting, or null. `liveHost` is mongoose.connection.host (a host name, never a credential). */
export const liveConnectionProblem = ({ liveName, liveHost }) => {
  if (liveName !== EXPECTED_DB) return `Refusing: the live connection is to "${liveName}", not "${EXPECTED_DB}". Nothing was written.`;
  if (!hostIsExpectedCluster(liveHost)) return `Refusing: the live connection's host is not part of the confirmed cluster ${EXPECTED_CLUSTER_HOST}. Nothing was written.`;
  return null;
};

export const indexSafetyProblem = (mongooseLike) => {
  const bad = ["autoIndex", "autoCreate"].filter((key) => mongooseLike.get(key) !== false);
  return bad.length ? `Refusing: Mongoose ${bad.join(" and ")} ${bad.length === 1 ? "is" : "are"} not false, so loading the models could build indexes or create collections in the TEST database. Nothing was written.` : null;
};
export const applyIndexSafety = (mongooseLike) => {
  mongooseLike.set("autoIndex", false);
  mongooseLike.set("autoCreate", false);
  return indexSafetyProblem(mongooseLike);
};

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

// ---------- READ-ONLY preflight ----------

/**
 * Reads only. Needs no login. Refuses (returns { refused, reason }) if ANY planned name, mobile, season, date window or entry is
 * already in use, so nothing existing can be reused, overwritten or mixed with the test data.
 * deps: readLabours(filter), readSeasons(), readProduction(filter), today()
 */
export const runPreflight = async (deps, { base }) => {
  const refuse = (reason) => ({ refused: true, reason });
  if (!isValidDate(base)) return refuse("the window start is not a valid date");
  const plan = planDates(base);
  const today = deps.today();
  if (plan.windowEnd > today) return refuse(`the test window ${base}..${plan.windowEnd} must be entirely in the past (today is ${today}); choose an earlier --window-start`);
  const ids = new Set();
  const labours = await deps.readLabours({});
  for (const l of labours) ids.add(String(l._id));
  const wantedNames = [...Object.values(FIXTURE.teams).map((t) => t.name), FIXTURE.nonPatlavale.name].map((n) => n.toLowerCase());
  const wantedMobiles = [...Object.values(FIXTURE.teams).map((t) => t.mobile), FIXTURE.nonPatlavale.mobile];
  const nameHits = labours.filter((l) => wantedNames.includes(String(l.name ?? "").trim().toLowerCase()));
  if (nameHits.length) return refuse(`a worker with a planned test name already exists (${nameHits.map(idOf).join(", ")}); nothing was written`);
  const mobileHits = labours.filter((l) => wantedMobiles.includes(String(l.mobile ?? "")));
  if (mobileHits.length) return refuse(`a worker with a planned test mobile number already exists (${mobileHits.map(idOf).join(", ")}); nothing was written`);
  if (ids.has(FIXTURE.unknownTeamId)) return refuse(`${FIXTURE.unknownTeamId} exists, but the unknown-team test needs it to be absent`);

  const seasons = await deps.readSeasons();
  const seasonNameHits = seasons.filter((s) => [FIXTURE.seasons.s1.name, FIXTURE.seasons.s2.name].includes(s.name));
  if (seasonNameHits.length) return refuse(`a season with a planned test name already exists (${seasonNameHits.map(idOf).join(", ")}); nothing was written`);
  const overlap = seasons.filter((s) => s.startDate <= plan.windowEnd && plan.base <= (s.endDate ?? "9999-12-31"));
  if (overlap.length) return refuse(`${overlap.length} existing season(s) overlap the test window ${plan.base}..${plan.windowEnd} (${overlap.map((s) => `${s.name}: ${s.startDate}..${s.endDate ?? "ongoing"}, ${s.status}`).join("; ")}); choose another --window-start`);

  const used = await deps.readProduction({ date: { $gte: plan.base, $lte: plan.windowEnd } });
  if (used.length) return refuse(`${used.length} production entr${used.length === 1 ? "y" : "ies"} (live or deleted) already exist inside the test window; nothing was written`);

  return { refused: false, plan, existingLabourIds: [...ids], counts: { labours: labours.length, seasons: seasons.length, entriesInWindow: 0 } };
};

// ---------- Recording ----------

/** Required checks per group. A fully successful run records exactly these; anything missing makes the group INCONCLUSIVE. */
export const REQUIRED = Object.freeze({
  FIXTURES: ["seasonCreated", "seasonPersisted", "teamsCreated", "teamIdsNew", "teamsPersisted", "oneRateRowEach", "nonPatlavaleCreated"],
  P1: [
    "payable_1", "physical_1", "earn_1", "payable_3", "physical_3", "earn_3", "payable_4", "physical_4", "earn_4", "payable_5", "physical_5", "earn_5", "payable_10", "physical_10", "earn_10",
    "persistedIntegers", "noFlooring", "noCarryForward", "physicalNotUsed", "roundingBoundary", "roundingOncePerEntry", "roundingUtility", "totalIsSumOfStored",
  ],
  P2: [
    "bulkSaved", "bulkPersisted", "oneLivePerTeamDate", "resaveIdempotent", "resaveNoNewDocs", "correctionSameEntry", "correctionNoDuplicate",
    "rejectUnknownTeam", "rejectNonPatlavale", "rejectDuplicateRows", "rejectDecimal", "rejectNegative", "rejectStringNumber", "rejectUnsupportedRowField", "rejectUnsupportedBodyField", "rejectOneBadRowWholeRequest",
    "noPartialEntries", "teamsIndependent", "datesIndependent",
  ],
  P3: ["rateChanged", "oldSnapshotKept", "newSnapshotNew", "boundaryDateUsesNewRate", "laterRateChangeKeepsOldEarnings", "correctionKeepsSnapshot", "backdatedReasonRequired", "backdatedReasonRejectionWroteNothing", "snapshotsInPaise"],
  P4: [
    "correctionRecalculates", "revisionIncreased", "historyHasPrevious", "historyActorTimeReason", "reasonRequired", "noopNoRevision", "noopNoHistory",
    "dateMoveOk", "dateMoveOldSlotFree", "dateMoveFuture", "dateMoveNoSeason", "dateMoveBeforeJoining", "dateMoveDuplicateSlot",
    "deleteNeedsReason", "deleteOk", "deletedStillStored", "deletedMetadata", "deletedExcludedFromTotals", "deletedSlotReusable", "deletedNotCorrectable", "deletedNotDeletable", "nothingHardDeleted",
  ],
  P5: [
    "noSeasonRejected", "closedSeasonSaveRejected", "closedSeasonCorrectRejected", "closedSeasonDeleteRejected", "dateMoveIntoClosedSeason", "closedSeasonUnchanged",
    "seasonTotalsMatchPersisted", "teamTotalsMatchPersisted", "noFlooringInTotals", "snapshotsRespectedInTotals", "deletedExcludedFromSeason",
    "paymentCreated", "paymentPersisted", "paymentLeavesSeasonTotals", "paymentLeavesTeamTotals", "paymentLeavesEntries", "sourceIndependentOfPayments",
  ],
  T: [
    "controlSaved", "controlBothPersisted", "rivalFiredOnce", "rivalPatch200", "rivalCommittedFirst", "batchHttp409", "batchMessage", "otherRowNotSaved", "rivalNotOverwritten", "rivalHistoryIntact",
    "opSequence", "retriesBounded", "hookRestored", "failedSaveWroteNothingElse",
  ],
});

const makeRecorder = () => {
  const groups = Object.fromEntries(Object.keys(REQUIRED).map((g) => [g, { checks: {}, fails: [], notes: [], stopped: null }]));
  const check = (group, name, ok, detail = "") => {
    const g = groups[group];
    if (name in g.checks) {
      g.checks[name] = false;
      g.fails.push(`${name}: recorded twice`);
      return false;
    }
    g.checks[name] = Boolean(ok);
    if (!ok) g.fails.push(detail ? `${name}: ${detail}` : name);
    return Boolean(ok);
  };
  const eq = (group, name, actual, expected) => check(group, name, same(actual, expected), `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  return { groups, check, eq };
};

export const groupVerdict = (name, g) => {
  if (g.fails.length) return "FAIL";
  if (g.stopped) return "INCONCLUSIVE";
  const missing = REQUIRED[name].filter((c) => !(c in g.checks));
  return missing.length ? "INCONCLUSIVE" : "PASS";
};
export const overall = (groups) => {
  const verdicts = Object.keys(REQUIRED).map((n) => groupVerdict(n, groups[n]));
  if (verdicts.includes("FAIL")) return "FAIL";
  if (verdicts.includes("INCONCLUSIVE")) return "INCONCLUSIVE";
  return "PASS";
};

// ---------- The run ----------

class Stop extends Error {}

export const runPatlavale = async (deps, { approved, mode = "ATLAS", watchdogMs = 30000 } = {}) => {
  const log = deps.log ?? (() => {});
  const rec = makeRecorder();
  const plan = approved.plan;
  const ids = {};
  const created = { season1: null, season2: null, teams: {}, nonPatlavale: null, entries: new Set(), payments: [] };
  const R = FIXTURE.reasons;
  const notes = [];
  const api = deps.api;
  const reads = {
    byTeamDate: async (teamId, date) => eachSecond(await deps.readProduction({ teamId, date })),
    byDate: async (date) => eachSecond(await deps.readProduction({ date })),
    byTeam: async (teamId) => eachSecond(await deps.readProduction({ teamId })),
    bySeason: async (seasonId) => eachSecond(await deps.readProduction({ seasonId })),
  };
  const putDay = (date, rows, reason = R.day, extra = {}) => api("put", `/api/production-entries/day/${date}`, { rows, ...(reason === null ? {} : { reason }), ...extra });
  const rememberEntries = (rows) => rows.forEach((r) => created.entries.add(idOf(r)));
  const live1 = async (teamId, date) => {
    const rows = liveRows(await reads.byTeamDate(teamId, date));
    rememberEntries(rows);
    return rows;
  };
  const row = (teamKey, maaps, extra = {}) => ({ teamId: ids[teamKey], maaps, ...extra });
  const rejected = (res) => res.status === 400 || res.status === 409;
  const asPaise = (rupees) => deps.money.rupeesToPaise(rupees);

  // ----- Fixtures (create-only). Any problem here stops the run: later groups cannot be trusted -----
  const buildFixtures = async () => {
    const G = "FIXTURES";
    const s1 = await api("post", "/api/seasons", { name: plan.s1.name, startDate: plan.s1.startDate, endDate: plan.s1.endDate });
    if (!rec.check(G, "seasonCreated", s1.status === 201 && s1.body?.data?.id, `HTTP ${s1.status}`)) throw new Stop("the test season could not be created");
    created.season1 = String(s1.body.data.id);
    const s2 = await api("post", "/api/seasons", { name: plan.s2.name, startDate: plan.s2.startDate, endDate: plan.s2.endDate });
    if (s2.status !== 201 || !s2.body?.data?.id) throw new Stop(`the second test season could not be created (HTTP ${s2.status})`);
    created.season2 = String(s2.body.data.id);
    const seasons = await deps.readSeasons();
    const mine = seasons.filter((s) => [created.season1, created.season2].includes(idOf(s)));
    rec.check(G, "seasonPersisted", mine.length === 2 && mine.every((s) => s.status === "OPEN") && mine.find((s) => idOf(s) === created.season1)?.startDate === plan.s1.startDate, `read back ${mine.length} season row(s)`);

    const before = new Set(approved.existingLabourIds);
    let allCreated = true;
    let allNew = true;
    for (const [key, spec] of Object.entries(FIXTURE.teams)) {
      const res = await api("post", "/api/labours", { labourType: "PATLAVALE", name: spec.name, mobile: spec.mobile, village: "Test", joiningDate: plan.joining, ratePer1000PayableBricks: spec.rate });
      if (res.status !== 201 || !res.body?.data?.id) {
        allCreated = false;
        throw new Stop(`creating ${spec.name} returned HTTP ${res.status}`);
      }
      ids[key] = String(res.body.data.id);
      created.teams[key] = ids[key];
      if (before.has(ids[key])) allNew = false;
    }
    rec.check(G, "teamsCreated", allCreated);
    rec.check(G, "teamIdsNew", allNew, "a new team received the id of a worker that existed before the run");
    if (!allNew) throw new Stop("a created team has the id of an existing worker");
    const np = await api("post", "/api/labours", { labourType: "MAAPVALI", name: FIXTURE.nonPatlavale.name, mobile: FIXTURE.nonPatlavale.mobile, village: "Test", joiningDate: plan.joining, ratePerFourMaaps: FIXTURE.nonPatlavale.ratePerFourMaaps });
    if (!rec.check(G, "nonPatlavaleCreated", np.status === 201 && np.body?.data?.id && !before.has(String(np.body.data.id)), `HTTP ${np.status}`)) throw new Stop("the non-Patlavale test worker could not be created");
    ids.N = String(np.body.data.id);
    created.nonPatlavale = ids.N;

    let persisted = true;
    let rateRows = true;
    for (const [key, spec] of Object.entries(FIXTURE.teams)) {
      const [doc] = await deps.readLabours({ _id: ids[key] });
      if (!doc || doc.name !== spec.name || doc.mobile !== spec.mobile || doc.labourType !== "PATLAVALE") persisted = false;
      const rates = await deps.readRates(ids[key]);
      if (rates.length !== 1 || rates[0].ratePaise !== asPaise(spec.rate)) rateRows = false;
    }
    rec.check(G, "teamsPersisted", persisted, "a team's stored name, mobile or type differs");
    rec.check(G, "oneRateRowEach", rateRows, "each new team must have exactly one rate row at its starting rate");
    if (!persisted || !rateRows) throw new Stop("fixture read-back failed");
  };

  // ----- P1: calculation rules -----
  const p1 = async () => {
    const G = "P1";
    const cases = [[1, 0], [3, 1], [4, 2], [5, 3], [10, 4]];
    const expected = { 1: [250, 275, 17500], 3: [750, 825, 52500], 4: [1000, 1100, 70000], 5: [1250, 1375, 87500], 10: [2500, 2750, 175000] };
    let integers = true;
    const storedPaise = [];
    for (const [maaps, i] of cases) {
      const date = plan.p1[i];
      const res = await putDay(date, [row("A", maaps)]);
      const item = res.body?.data?.items?.[0];
      const [p, ph, e] = expected[maaps];
      rec.check(G, `payable_${maaps}`, res.status === 200 && item?.newPayableBricks === p, `HTTP ${res.status}`);
      rec.check(G, `physical_${maaps}`, item?.newPhysicalBricks === ph, `got ${item?.newPhysicalBricks}`);
      const [stored] = await live1(ids.A, date);
      const ok = stored && stored.payableBricks === p && stored.earningsPaise === e && stored.ratePaise === 70000 && stored.numberOfMaaps === maaps && asPaise(item?.newEarnings) === e;
      rec.check(G, `earn_${maaps}`, ok, `stored ${JSON.stringify(stored && { m: stored.numberOfMaaps, p: stored.payableBricks, e: stored.earningsPaise, r: stored.ratePaise })}`);
      if (!stored || ![stored.payableBricks, stored.earningsPaise, stored.ratePaise, stored.numberOfMaaps].every(Number.isInteger)) integers = false;
      storedPaise.push(stored?.earningsPaise);
    }
    rec.check(G, "persistedIntegers", integers, "payable bricks, rate, earnings and maaps must all be stored as integers");
    const one = (await live1(ids.A, plan.p1[0]))[0];
    rec.check(G, "noFlooring", one?.earningsPaise === 17500 && one?.earningsPaise !== 0, "1 maap must earn 1/4 of the rate, not 0");
    const three = (await live1(ids.A, plan.p1[1]))[0];
    const five = (await live1(ids.A, plan.p1[3]))[0];
    rec.check(G, "noCarryForward", three?.earningsPaise === 52500 && five?.earningsPaise === 87500 && !("carryForward" in (five ?? {})) && !("remainder" in (five ?? {})), "a day's earnings must depend only on that day's maaps");
    const four = (await live1(ids.A, plan.p1[2]))[0];
    rec.check(G, "physicalNotUsed", four?.earningsPaise === 70000 && four.earningsPaise !== Math.floor((1100 * 70000) / 1000), "earnings must come from payable bricks (4 maaps = 1,000), never from the 1,100 physical bricks");

    // Rounding boundary: team E is paid 700.02 per 4 maaps = 70,002 paise. 1 maap = 17,500.5 -> 17,501; 3 maaps = 52,501.5 -> 52,502.
    const r1 = await putDay(plan.round[0], [row("E", 1)]);
    const r3 = await putDay(plan.round[1], [row("E", 3)]);
    const [e1] = await live1(ids.E, plan.round[0]);
    const [e3] = await live1(ids.E, plan.round[1]);
    rec.check(G, "roundingBoundary", r1.status === 200 && r3.status === 200 && e1?.earningsPaise === 17501 && e3?.earningsPaise === 52502, `got ${e1?.earningsPaise} and ${e3?.earningsPaise} (expected 17501 and 52502)`);
    rec.check(G, "roundingOncePerEntry", e1 && e3 && e1.earningsPaise + e3.earningsPaise === 70003 && expectedEarningsPaise(4, 70002) === 70002, "per-entry rounding sums to 70,003, not the 70,002 of the combined 4 maaps");
    const util = [deps.money.earningsPaiseForMaaps(1, 70002), deps.money.earningsPaiseForMaaps(3, 70002), deps.money.earningsPaiseForMaaps(4, 70000)];
    rec.check(G, "roundingUtility", same(util, [17501, 52502, 70000]) && e1?.earningsPaise === util[0] && e3?.earningsPaise === util[1], `money utility returned ${JSON.stringify(util)}`);
    const season = await api("get", `/api/seasons/${created.season1}/production`);
    const teamE = season.body?.data?.teams?.find((t) => t.teamId === ids.E);
    rec.check(G, "totalIsSumOfStored", teamE && asPaise(teamE.earnings) === e1.earningsPaise + e3.earningsPaise, `team E total ${teamE?.earnings}`);
  };

  // ----- P2: daily bulk production -----
  const p2 = async () => {
    const G = "P2";
    const day = plan.p2.day;
    const res = await putDay(day, [row("B", 2), row("C", 3), row("D", 4)]);
    rec.check(G, "bulkSaved", res.status === 200 && res.body?.data?.saved?.created === 3 && res.body.data.items.length === 3, `HTTP ${res.status}, ${JSON.stringify(res.body?.data?.saved)}`);
    const rows = eachSecond(await deps.readProduction({ date: day }));
    rememberEntries(rows);
    const byTeam = Object.fromEntries(rows.map((r) => [r.teamId, r]));
    rec.check(G, "bulkPersisted", rows.length === 3 && byTeam[ids.B]?.numberOfMaaps === 2 && byTeam[ids.C]?.numberOfMaaps === 3 && byTeam[ids.D]?.numberOfMaaps === 4, `${rows.length} stored row(s)`);
    rec.check(G, "oneLivePerTeamDate", new Set(liveRows(rows).map((r) => r.teamId)).size === liveRows(rows).length, "two live entries for one team and date");
    const idsBefore = rows.map(idOf);
    const again = await putDay(day, [row("B", 2), row("C", 3), row("D", 4)]);
    const rowsAgain = eachSecond(await deps.readProduction({ date: day }));
    rec.check(G, "resaveIdempotent", again.status === 200 && again.body?.data?.saved?.created === 0 && again.body.data.saved.updated === 0 && again.body.data.saved.unchanged === 3, JSON.stringify(again.body?.data?.saved));
    rec.check(G, "resaveNoNewDocs", same(rowsAgain.map(idOf), idsBefore) && rowsAgain.every((r) => r.revision === 1), "same ids and revision 1 expected after an identical save");
    const fix = await putDay(day, [row("B", 2), row("C", 6), row("D", 4)]);
    const afterFix = eachSecond(await deps.readProduction({ date: day }));
    const c = afterFix.find((r) => r.teamId === ids.C);
    rec.check(G, "correctionSameEntry", fix.status === 200 && fix.body?.data?.saved?.updated === 1 && idOf(c) === idOf(rows.find((r) => r.teamId === ids.C)) && c.numberOfMaaps === 6 && c.revision === 2, `HTTP ${fix.status}`);
    rec.check(G, "correctionNoDuplicate", afterFix.length === 3 && afterFix.filter((r) => r.teamId === ids.C).length === 1, `${afterFix.length} stored row(s)`);

    // Rejections: each is its own request on a date that must stay completely empty.
    const bad = plan.p2.invalid;
    const attempt = async (name, body, status = 400) => {
      const r = await api("put", `/api/production-entries/day/${bad}`, { reason: R.day, ...body });
      rec.check(G, name, r.status === status, `HTTP ${r.status}`);
    };
    await attempt("rejectUnknownTeam", { rows: [row("B", 1), { teamId: FIXTURE.unknownTeamId, maaps: 1 }] });
    await attempt("rejectNonPatlavale", { rows: [row("B", 1), { teamId: ids.N, maaps: 1 }] });
    await attempt("rejectDuplicateRows", { rows: [row("B", 1), row("B", 2)] });
    await attempt("rejectDecimal", { rows: [row("B", 1.5)] });
    await attempt("rejectNegative", { rows: [row("B", -1)] });
    await attempt("rejectStringNumber", { rows: [row("B", "3")] });
    await attempt("rejectUnsupportedRowField", { rows: [{ teamId: ids.B, maaps: 1, ratePaise: 1 }] });
    await attempt("rejectUnsupportedBodyField", { rows: [row("B", 1)], earnings: 1 });
    await attempt("rejectOneBadRowWholeRequest", { rows: [row("B", 2), row("C", 2), { teamId: ids.D, maaps: 1.5 }] });
    const leftovers = await reads.byDate(bad);
    rec.check(G, "noPartialEntries", leftovers.length === 0, `${leftovers.length} entr${leftovers.length === 1 ? "y" : "ies"} found on the date every rejected request used`);

    // Independence: another date and another team do not disturb day 1.
    const snapshot = eachSecond(await deps.readProduction({ date: day })).map((r) => [idOf(r), r.numberOfMaaps, r.revision, r.earningsPaise]);
    const other = await putDay(plan.p2.other, [row("B", 5)]);
    const snapshotAfter = eachSecond(await deps.readProduction({ date: day })).map((r) => [idOf(r), r.numberOfMaaps, r.revision, r.earningsPaise]);
    rec.check(G, "datesIndependent", other.status === 200 && same(snapshot, snapshotAfter), "saving another date changed the first day");
    const aRows = await reads.byTeam(ids.A);
    rec.check(G, "teamsIndependent", aRows.length === 5 && aRows.every((r) => r.revision === 1), "team A's entries must not be touched by other teams' saves");
    rememberEntries(await reads.byDate(plan.p2.other));
  };

  // ----- P3: rate snapshots and backdated production -----
  const p3 = async () => {
    const G = "P3";
    const pre = (await live1(ids.C, plan.p2.day))[0]; // 6 maaps at the starting 700 (from P2)
    const change = await api("post", `/api/labours/${ids.C}/rates`, { newRate: 800, effectiveFrom: plan.p3.rateChange, reason: R.rate });
    const rates = await deps.readRates(ids.C);
    rec.check(G, "rateChanged", change.status === 201 && rates.length === 2 && rates.some((r) => r.ratePaise === 80000 && r.effectiveFrom === plan.p3.rateChange), `HTTP ${change.status}, ${rates.length} rate row(s)`);
    const before = await putDay(plan.p3.before, [row("C", 4)]);
    const [eBefore] = await live1(ids.C, plan.p3.before);
    rec.check(G, "oldSnapshotKept", before.status === 200 && eBefore?.ratePaise === 70000 && eBefore?.earningsPaise === 70000, `rate ${eBefore?.ratePaise}, earnings ${eBefore?.earningsPaise} (backdated before the change: the old rate applies)`);
    const edge = await putDay(plan.p3.rateChange, [row("C", 1)]);
    const [eEdge] = await live1(ids.C, plan.p3.rateChange);
    rec.check(G, "boundaryDateUsesNewRate", edge.status === 200 && eEdge?.ratePaise === 80000 && eEdge?.earningsPaise === 20000, `rate ${eEdge?.ratePaise}`);
    const after = await putDay(plan.p3.after, [row("C", 4)]);
    const [eAfter] = await live1(ids.C, plan.p3.after);
    rec.check(G, "newSnapshotNew", after.status === 200 && eAfter?.ratePaise === 80000 && eAfter?.earningsPaise === 80000, `rate ${eAfter?.ratePaise}`);
    const [preNow] = await live1(ids.C, plan.p2.day);
    rec.check(G, "laterRateChangeKeepsOldEarnings", pre && preNow && preNow.ratePaise === 70000 && preNow.earningsPaise === pre.earningsPaise && preNow.earningsPaise === expectedEarningsPaise(6, 70000), `earnings ${preNow?.earningsPaise}`);
    const fix = await api("patch", `/api/production-entries/${idOf(preNow)}`, { newMaaps: 8, reason: R.fix });
    const [fixed] = await live1(ids.C, plan.p2.day);
    rec.check(G, "correctionKeepsSnapshot", fix.status === 200 && fixed?.ratePaise === 70000 && fixed?.numberOfMaaps === 8 && fixed?.earningsPaise === expectedEarningsPaise(8, 70000), `rate ${fixed?.ratePaise}, earnings ${fixed?.earningsPaise}`);
    const noReason = await putDay(plan.p3.later, [row("C", 2)], null);
    rec.check(G, "backdatedReasonRequired", noReason.status === 400 && JSON.stringify(noReason.body?.errors ?? noReason.body).includes("reason"), `HTTP ${noReason.status}`);
    rec.check(G, "backdatedReasonRejectionWroteNothing", (await reads.byDate(plan.p3.later)).length === 0, "an entry exists on the date used for the rejected request");
    const all = await reads.byTeam(ids.C);
    rec.check(G, "snapshotsInPaise", all.length >= 4 && all.every((r) => Number.isInteger(r.ratePaise) && Number.isInteger(r.earningsPaise) && r.earningsPaise === expectedEarningsPaise(r.numberOfMaaps, r.ratePaise)), "each stored earnings must equal maaps/4 x its own stored rate");
  };

  // ----- P4: corrections, history and deletion -----
  const p4 = async () => {
    const G = "P4";
    const [entry] = await live1(ids.D, plan.p2.day); // 4 maaps at 700
    const fix = await api("patch", `/api/production-entries/${idOf(entry)}`, { newMaaps: 7, reason: R.fix });
    const [fixed] = await live1(ids.D, plan.p2.day);
    const dto = fix.body?.data;
    rec.check(G, "correctionRecalculates", fix.status === 200 && fixed?.numberOfMaaps === 7 && fixed.payableBricks === 1750 && fixed.earningsPaise === 122500 && dto?.newPhysicalBricks === 1925 && asPaise(dto?.newEarnings) === 122500, `HTTP ${fix.status}`);
    rec.check(G, "revisionIncreased", fixed?.revision === 2 && dto?.revision === 2, `revision ${fixed?.revision}`);
    const h = fixed?.history?.[0];
    rec.check(G, "historyHasPrevious", fixed?.history?.length === 1 && h?.before?.numberOfMaaps === 4 && h.before.payableBricks === 1000 && h.before.earningsPaise === 70000, JSON.stringify(h?.before));
    rec.check(G, "historyActorTimeReason", Boolean(h?.by) && h?.reason === R.fix && !Number.isNaN(Date.parse(h?.at)), `by ${h?.by}, reason ${h?.reason}`);
    const noReason = await api("patch", `/api/production-entries/${idOf(entry)}`, { newMaaps: 9 });
    rec.check(G, "reasonRequired", noReason.status === 400 && (await live1(ids.D, plan.p2.day))[0].numberOfMaaps === 7, `HTTP ${noReason.status}`);
    const noop = await api("patch", `/api/production-entries/${idOf(entry)}`, { newMaaps: 7, reason: R.fix });
    const [afterNoop] = await live1(ids.D, plan.p2.day);
    rec.check(G, "noopNoRevision", noop.status === 200 && afterNoop?.revision === 2, `revision ${afterNoop?.revision}`);
    rec.check(G, "noopNoHistory", afterNoop?.history?.length === 1, `${afterNoop?.history?.length} history row(s)`);

    // Date changes
    const made = await putDay(plan.p4.move, [row("D", 3)]);
    const [mover] = await live1(ids.D, plan.p4.move);
    const moved = await api("patch", `/api/production-entries/${idOf(mover)}`, { date: plan.p4.target, reason: R.fix });
    const [movedRow] = await live1(ids.D, plan.p4.target);
    rec.check(G, "dateMoveOk", made.status === 200 && moved.status === 200 && movedRow && idOf(movedRow) === idOf(mover) && movedRow.date === plan.p4.target && movedRow.revision === 2 && movedRow.history[0].before.date === plan.p4.move && movedRow.seasonId === created.season1, `HTTP ${moved.status}`);
    rec.check(G, "dateMoveOldSlotFree", (await live1(ids.D, plan.p4.move)).length === 0, "the old date must have no live entry after the move");
    const tomorrow = addDays(deps.today(), 1);
    const attempt = async (name, body, status = [400, 409]) => {
      const r = await api("patch", `/api/production-entries/${idOf(movedRow)}`, { ...body, reason: R.fix });
      const [now] = await live1(ids.D, plan.p4.target);
      rec.check(G, name, status.includes(r.status) && now?.revision === 2 && now?.date === plan.p4.target, `HTTP ${r.status}`);
    };
    await attempt("dateMoveFuture", { date: tomorrow });
    await attempt("dateMoveNoSeason", { date: plan.p5.noSeason });
    await attempt("dateMoveBeforeJoining", { date: plan.p5.beforeJoining });
    await attempt("dateMoveDuplicateSlot", { date: plan.p2.day }, [409]);

    // Soft delete
    const noDelReason = await api("delete", `/api/production-entries/${idOf(movedRow)}`, {});
    rec.check(G, "deleteNeedsReason", noDelReason.status === 400 && (await live1(ids.D, plan.p4.target)).length === 1, `HTTP ${noDelReason.status}`);
    const seasonBefore = (await api("get", `/api/seasons/${created.season1}/production`)).body?.data;
    const del = await api("delete", `/api/production-entries/${idOf(movedRow)}`, { reason: R.del });
    rec.check(G, "deleteOk", del.status === 200 && del.body?.data?.isDeleted === true, `HTTP ${del.status}`);
    const stored = (await reads.byTeamDate(ids.D, plan.p4.target)).find((r) => idOf(r) === idOf(movedRow));
    rec.check(G, "deletedStillStored", Boolean(stored) && stored.isDeleted === true && stored.numberOfMaaps === 3, "the deleted entry must remain in the collection with its values");
    rec.check(G, "deletedMetadata", Boolean(stored?.deletedAt) && stored?.deletedReason === R.del && Boolean(stored?.deletedBy), JSON.stringify({ at: Boolean(stored?.deletedAt), reason: stored?.deletedReason, by: Boolean(stored?.deletedBy) }));
    const seasonAfter = (await api("get", `/api/seasons/${created.season1}/production`)).body?.data;
    rec.check(G, "deletedExcludedFromTotals", seasonBefore && seasonAfter && seasonAfter.summary.maaps === seasonBefore.summary.maaps - 3 && seasonAfter.summary.entries === seasonBefore.summary.entries - 1, `${seasonBefore?.summary?.maaps} -> ${seasonAfter?.summary?.maaps} maaps`);
    const reuse = await putDay(plan.p4.target, [row("D", 2)]);
    const both = await reads.byTeamDate(ids.D, plan.p4.target);
    rememberEntries(both);
    rec.check(G, "deletedSlotReusable", reuse.status === 200 && both.length === 2 && liveRows(both).length === 1 && liveRows(both)[0].numberOfMaaps === 2 && idOf(liveRows(both)[0]) !== idOf(movedRow), `${both.length} stored row(s)`);
    const fixDeleted = await api("patch", `/api/production-entries/${idOf(movedRow)}`, { newMaaps: 5, reason: R.fix });
    const delAgain = await api("delete", `/api/production-entries/${idOf(movedRow)}`, { reason: R.del });
    const storedAgain = (await reads.byTeamDate(ids.D, plan.p4.target)).find((r) => idOf(r) === idOf(movedRow));
    rec.check(G, "deletedNotCorrectable", fixDeleted.status === 409 && storedAgain?.numberOfMaaps === 3, `HTTP ${fixDeleted.status}`);
    rec.check(G, "deletedNotDeletable", delAgain.status === 409 && storedAgain?.isDeleted === true, `HTTP ${delAgain.status}`);
    const everyId = new Set((await deps.readProduction({ teamId: { $in: Object.values(created.teams) } })).map(idOf));
    rec.check(G, "nothingHardDeleted", [...created.entries].every((id) => everyId.has(id)), "an entry this run created is no longer in the collection");
  };

  // ----- P5: seasons, totals and payment independence -----
  const p5 = async () => {
    const G = "P5";
    const noSeason = await putDay(plan.p5.noSeason, [row("B", 1)]);
    rec.check(G, "noSeasonRejected", noSeason.status === 400 && (await reads.byDate(plan.p5.noSeason)).length === 0, `HTTP ${noSeason.status}`);

    // Season 2: one entry while open, then close it (our own season), then every change must be refused.
    const open = await putDay(plan.p5.closedOpenDay, [row("B", 2)]);
    const [inS2] = await live1(ids.B, plan.p5.closedOpenDay);
    // Over the API a season is closed only by the settlement close (which writes permanent settlement records, wrong for a test season), so the
    // runner supplies `closeSeason`, which uses the internal service. Without it the old PATCH is tried (the API now refuses it with 409).
    const close = await (deps.closeSeason ?? ((id) => api("patch", `/api/seasons/${id}`, { status: "CLOSED" })))(created.season2);
    const save = await putDay(plan.p5.closedTry, [row("B", 3)]);
    const fix = await api("patch", `/api/production-entries/${idOf(inS2 ?? {})}`, { newMaaps: 9, reason: R.fix });
    const del = await api("delete", `/api/production-entries/${idOf(inS2 ?? {})}`, { reason: R.del });
    rec.check(G, "closedSeasonSaveRejected", open.status === 200 && close.status === 200 && save.status === 409 && (await reads.byDate(plan.p5.closedTry)).length === 0, `open ${open.status}, close ${close.status}, save ${save.status}`);
    rec.check(G, "closedSeasonCorrectRejected", fix.status === 409, `HTTP ${fix.status}`);
    rec.check(G, "closedSeasonDeleteRejected", del.status === 409, `HTTP ${del.status}`);
    const [stillS2] = await live1(ids.B, plan.p5.closedOpenDay);
    const [dEntry] = await live1(ids.D, plan.p4.target);
    const moveIn = await api("patch", `/api/production-entries/${idOf(dEntry ?? {})}`, { date: plan.p5.closedOpenDay, reason: R.fix });
    const [dAfter] = await live1(ids.D, plan.p4.target);
    rec.check(G, "dateMoveIntoClosedSeason", Boolean(dEntry) && [400, 409].includes(moveIn.status) && dAfter?.date === plan.p4.target && dAfter.revision === dEntry.revision, `HTTP ${moveIn.status}`);
    rec.check(G, "closedSeasonUnchanged", stillS2?.numberOfMaaps === 2 && stillS2?.revision === 1 && stillS2?.isDeleted === false, "the entry in the closed season must be untouched");

    // Totals: every figure is recomputed from the persisted rows.
    const season = (await api("get", `/api/seasons/${created.season1}/production`)).body?.data;
    const rows = liveRows(await reads.bySeason(created.season1));
    const totals = { entries: rows.length, maaps: sum(rows.map((r) => r.numberOfMaaps)), payableBricks: sum(rows.map((r) => r.payableBricks)), physicalBricks: sum(rows.map((r) => r.numberOfMaaps)) * 275, earningsPaise: sum(rows.map((r) => r.earningsPaise)) };
    const got = season && { entries: season.summary.entries, maaps: season.summary.maaps, payableBricks: season.summary.payableBricks, physicalBricks: season.summary.physicalBricks, earningsPaise: asPaise(season.summary.earnings) };
    rec.eq(G, "seasonTotalsMatchPersisted", got, totals);
    const teamOk = Object.values(ids).length > 0 && season?.teams?.length > 0 && season.teams.every((t) => {
      const mine = rows.filter((r) => r.teamId === t.teamId);
      return t.entries === mine.length && t.maaps === sum(mine.map((r) => r.numberOfMaaps)) && asPaise(t.earnings) === sum(mine.map((r) => r.earningsPaise));
    }) && season.teams.length === new Set(rows.map((r) => r.teamId)).size;
    rec.check(G, "teamTotalsMatchPersisted", teamOk, "a team line differs from the sum of that team's stored entries");
    rec.check(G, "noFlooringInTotals", rows.some((r) => r.numberOfMaaps % 4 !== 0) && season?.summary?.payableBricks === totals.maaps * 250 && season?.summary?.physicalBricks === totals.maaps * 275, `total maaps ${totals.maaps}: payable and physical must be exact (every maap counts), not rounded to groups of 4`);
    const teamC = rows.filter((r) => r.teamId === ids.C);
    const byStored = sum(teamC.map((r) => r.earningsPaise));
    const byToday = sum(teamC.map((r) => expectedEarningsPaise(r.numberOfMaaps, 80000)));
    const lineC = season?.teams?.find((t) => t.teamId === ids.C);
    rec.check(G, "snapshotsRespectedInTotals", lineC && asPaise(lineC.earnings) === byStored && byStored !== byToday, `team C total ${lineC?.earnings}; stored ${byStored}; if everything used today's rate it would be ${byToday}`);
    const deletedLive = (await reads.bySeason(created.season1)).filter((r) => r.isDeleted);
    rec.check(G, "deletedExcludedFromSeason", deletedLive.length >= 1 && totals.entries === liveRows(await reads.bySeason(created.season1)).length && got?.entries === totals.entries, `${deletedLive.length} deleted entr${deletedLive.length === 1 ? "y" : "ies"} must not be counted`);

    // Payment independence (one SALARY payment to team E, a NEW team; the first and only payment write of this run)
    const entriesBefore = JSON.stringify(eachSecond(await deps.readProduction({ teamId: { $in: Object.values(created.teams) } })));
    const teamBefore = (await api("get", `/api/seasons/${created.season1}/production`)).body?.data;
    const pay = await api("post", "/api/payments", { recipientId: ids.E, type: "SALARY_PAYMENT", amount: 123.45, date: plan.p5.payment, requestId: `zz-pat-verify-${plan.base.replaceAll("-", "")}` });
    rec.check(G, "paymentCreated", pay.status === 201 && Boolean(pay.body?.data?.id), `HTTP ${pay.status}`);
    const stored = await deps.readPayments({ recipientId: ids.E });
    if (stored.length) created.payments.push(...stored.map(idOf));
    rec.check(G, "paymentPersisted", stored.length === 1 && stored[0].amountPaise === 12345, `${stored.length} payment row(s)`);
    const teamAfter = (await api("get", `/api/seasons/${created.season1}/production`)).body?.data;
    rec.check(G, "paymentLeavesSeasonTotals", same(teamBefore?.summary, teamAfter?.summary) && Boolean(teamAfter), "season totals changed after a payment");
    rec.check(G, "paymentLeavesTeamTotals", same(teamBefore?.teams, teamAfter?.teams) && Boolean(teamAfter), "a team total changed after a payment");
    const entriesAfter = JSON.stringify(eachSecond(await deps.readProduction({ teamId: { $in: Object.values(created.teams) } })));
    rec.check(G, "paymentLeavesEntries", entriesBefore === entriesAfter, "a stored production entry changed after a payment");

    const files = ["services/productionEntry.service.js", "services/productionCalculations.js", "services/season.service.js", "models/ProductionEntry.js"];
    const hits = [];
    for (const f of files) {
      const text = stripComments(await deps.readSource(f));
      if (PAYMENT_DEPENDENCY.test(text)) hits.push(f);
    }
    rec.check(G, "sourceIndependentOfPayments", hits.length === 0, `these files reference payments or salary: ${hits.join(", ")}`);
  };

  // ----- T: transaction, rollback and a real conflict (same hook design as the race harness) -----
  const tGroup = async () => {
    const G = "T";
    const model = deps.ProductionEntry;
    const control = plan.t.control;
    const race = plan.t.race;
    // Control: no rival at all; a two-row batch commits as a whole.
    await putDay(control, [row("A", 2)]);
    const ctl = await putDay(control, [row("B", 3), row("A", 5)]);
    const ctlRows = liveRows(await reads.byDate(control));
    rememberEntries(ctlRows);
    rec.check(G, "controlSaved", ctl.status === 200 && ctl.body?.data?.saved?.created === 1 && ctl.body.data.saved.updated === 1, `HTTP ${ctl.status}`);
    const a = ctlRows.find((r) => r.teamId === ids.A);
    const b = ctlRows.find((r) => r.teamId === ids.B);
    rec.check(G, "controlBothPersisted", ctlRows.length === 2 && a?.numberOfMaaps === 5 && a.revision === 2 && b?.numberOfMaaps === 3 && b.revision === 1, `${ctlRows.length} row(s)`);

    // Race: A's entry exists at revision 1; a rival correction COMMITS (independently, over HTTP) just before the batch's guarded write.
    await putDay(race, [row("A", 2)]);
    const [seed] = await live1(ids.A, race);
    const events = [];
    const ops = [];
    const state = { phase: "ARMED", fired: 0, passed: 0, rivalStatus: null, rivalCommitted: false, problem: null };
    const descriptor = Object.getOwnPropertyDescriptor(model, "updateOne");
    const original = model.updateOne;
    const hookFn = async function (filter, update, options) {
      const kind = filter && filter._id !== undefined && filter.revision !== undefined ? "guarded" : options?.upsert === true ? "upsert" : "other";
      // The rival's own correction now runs in its own (required) transaction too (Phase 1C P6), so it is recognised by the FIRING phase,
      // not by the absence of a session.
      if (options?.session && state.phase !== "FIRING") ops.push(kind);
      if (state.phase === "FIRING") state.passed += 1;
      const target = state.phase !== "FIRING" && options?.session && kind === "guarded" && String(filter._id) === idOf(seed) && filter.revision === 1;
      if (state.phase === "ARMED" && target) {
        state.phase = "FIRING"; // before the rival runs, so its own writes pass straight through (no recursion)
        state.fired += 1;
        events.push("rival-start");
        const rivalRes = await api("patch", `/api/production-entries/${idOf(seed)}`, { newMaaps: 9, reason: R.rival });
        state.rivalStatus = rivalRes.status;
        events.push("rival-http");
        const [after] = eachSecond(await deps.readProduction({ _id: seed._id }));
        state.rivalCommitted = Boolean(after) && after.numberOfMaaps === 9 && after.revision === 2;
        events.push("rival-verified");
        state.phase = "DONE";
      }
      if (target) events.push("guarded-invoked");
      return original.call(this, filter, update, options);
    };
    let batch;
    try {
      model.updateOne = hookFn;
      let timer;
      batch = await Promise.race([
        putDay(race, [row("B", 3), row("A", 5)]),
        new Promise((resolve) => {
          timer = setTimeout(() => resolve({ status: "WATCHDOG", body: null }), watchdogMs);
        }),
      ]);
      clearTimeout(timer);
    } finally {
      if (descriptor) Object.defineProperty(model, "updateOne", descriptor);
      else delete model.updateOne;
    }
    rec.check(G, "hookRestored", model.updateOne === original, "ProductionEntry.updateOne was not restored");
    rec.check(G, "rivalFiredOnce", state.fired === 1 && state.passed >= 1, `fired ${state.fired}, rival's own write passed through ${state.passed}x`);
    rec.check(G, "rivalPatch200", state.rivalStatus === 200, `HTTP ${state.rivalStatus}`);
    rec.check(G, "rivalCommittedFirst", state.rivalCommitted && same(events.slice(0, 4), ["rival-start", "rival-http", "rival-verified", "guarded-invoked"]), JSON.stringify(events));
    rec.check(G, "batchHttp409", batch.status === 409, `HTTP ${batch.status}`);
    rec.check(G, "batchMessage", /Nothing was saved/.test(String(batch.body?.message ?? "")), String(batch.body?.message ?? ""));
    const day = await reads.byDate(race);
    rememberEntries(day);
    rec.check(G, "otherRowNotSaved", !day.some((r) => r.teamId === ids.B), "team B (the other row of the failed batch) has an entry");
    const finalA = day.find((r) => r.teamId === ids.A);
    rec.check(G, "rivalNotOverwritten", day.length === 1 && finalA?.numberOfMaaps === 9 && finalA.revision === 2, `A: ${finalA?.numberOfMaaps} maaps, revision ${finalA?.revision}`);
    rec.check(G, "rivalHistoryIntact", finalA?.history?.length === 1 && finalA.history[0].reason === R.rival && finalA.history[0].before.numberOfMaaps === 2, JSON.stringify(finalA?.history?.map((x) => x.reason)));
    const okSeq = [["upsert", "guarded"], ["upsert", "guarded", "upsert", "guarded"]];
    rec.check(G, "opSequence", okSeq.some((s) => same(s, ops)), `transaction ops [${ops.join(", ")}]`);
    rec.check(G, "retriesBounded", ops.length <= MAX_TRANSACTION_OPS, `${ops.length} write ops`);
    rec.check(G, "failedSaveWroteNothingElse", day.length === 1 && liveRows(day).every((r) => r.teamId === ids.A), "unexpected entries on the race date");
    notes.push(mode === "ATLAS" ? "T: real MongoDB transactions were exercised on the TEST cluster." : "T: MOCKED. The in-memory stand-in emulates rollback and a retry; this does NOT prove real Atlas transaction behaviour.");
  };

  // ----- Drive everything in order -----
  const steps = [["FIXTURES", buildFixtures], ["P1", p1], ["P2", p2], ["P3", p3], ["P4", p4], ["P5", p5], ["T", tGroup]];
  let stopped = null;
  for (const [name, fn] of steps) {
    if (stopped) {
      rec.groups[name].stopped = `NOT_RUN: ${stopped}`;
      continue;
    }
    try {
      await fn();
      log(`${name}: ${groupVerdict(name, rec.groups[name])}`);
    } catch (err) {
      const why = err instanceof Stop ? err.message : `${err?.name ?? "Error"}: ${String(err?.message ?? err).replace(/mongodb(?:\+srv)?:\/\/\S+/gi, "[hidden]")}`;
      rec.groups[name].stopped = `STOPPED: ${why}`;
      stopped = `${name} stopped (${why})`;
      log(`${name}: INCONCLUSIVE (${why})`);
    }
  }
  return { mode, verdict: overall(rec.groups), groups: rec.groups, created: { ...created, entries: [...created.entries] }, ids, plan, notes };
};

// ---------- Source independence check ----------

export const stripComments = (text) => String(text ?? "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
/** Any import of, or use of, the payment / salary modules or models. Comments are removed first. */
export const PAYMENT_DEPENDENCY = /from\s+["'][^"']*(?:payment|salary)[^"']*["']|\bPayment\b|\bSalaryPeriod\b|\bamountPaise\b/i;

// ---------- Flow and report ----------

/** Preflight first (read-only, no login); only then `startAndLogin()`; then the run. `startAndLogin` returns deps or { refused }. */
export const runGuarded = async ({ readDeps, startAndLogin, opts = {} }) => {
  const approved = await runPreflight(readDeps, opts);
  if (approved.refused) return { mode: opts.mode ?? "ATLAS", verdict: "REFUSED", reason: approved.reason, groups: null, loggedIn: false };
  const deps = await startAndLogin(approved);
  if (deps?.refused) return { mode: opts.mode ?? "ATLAS", verdict: "REFUSED", reason: deps.refused, groups: null, loggedIn: false };
  const result = await runPatlavale(deps, { approved, mode: opts.mode ?? "ATLAS", watchdogMs: opts.watchdogMs });
  return { ...result, loggedIn: true, preflight: approved.counts };
};

export const formatReport = (result, { dbName, host } = {}) => {
  const lines = [];
  const mocked = result.mode !== "ATLAS";
  const verdict = mocked ? `MOCKED-${result.verdict}` : result.verdict; // a mocked run can never print RESULT: PASS
  lines.push(`RESULT: ${verdict}${result.reason ? ` (${result.reason})` : ""}`);
  lines.push(`Test mode: ${mocked ? "MOCKED (in-memory; NOT Atlas evidence)" : "ATLAS"}`);
  if (dbName) lines.push(`Database: ${dbName}; cluster: ${host ?? "n/a"} (confirmed; no credentials shown)`);
  if (!result.groups) return lines;
  lines.push(`Test window: ${result.plan.base}..${result.plan.windowEnd}; joining date ${result.plan.joining}`);
  lines.push(`Season 1: ${result.created.season1} (${result.plan.s1.startDate}..${result.plan.s1.endDate}); Season 2: ${result.created.season2} (${result.plan.s2.startDate}..${result.plan.s2.endDate}, closed during P5)`);
  lines.push(`Fixture teams: ${JSON.stringify(result.created.teams)}; non-Patlavale worker: ${result.created.nonPatlavale}`);
  lines.push(`Entries created by this run: ${result.created.entries.length}; payments: ${JSON.stringify(result.created.payments)}`);
  for (const name of Object.keys(REQUIRED)) {
    const g = result.groups[name];
    const v = groupVerdict(name, g);
    lines.push(`- ${name}: ${v} (${REQUIRED[name].filter((c) => g.checks[c] === true).length}/${REQUIRED[name].length} required checks passed${g.stopped ? `; ${g.stopped}` : ""})`);
    for (const f of g.fails) lines.push(`    FAIL ${f}`);
    const missing = REQUIRED[name].filter((c) => !(c in g.checks));
    if (missing.length && v !== "PASS") lines.push(`    NOT RUN: ${missing.join(", ")}`);
  }
  for (const n of result.notes ?? []) lines.push(`Note: ${n}`);
  lines.push("No pre-existing worker, season or production entry was updated, soft-deleted or deleted. No automatic cleanup was performed: every fixture above is preserved.");
  return lines;
};
