// Phase 1C historical-data census: PURE logic. It only reads through the injected `read(collection, filter)` function, which the
// script wires to native find() calls. Nothing in this file can write: there is no write function to call, and the tests prove it.
import { EXPECTED_CLUSTER_HOST, EXPECTED_DB, hostIsExpectedCluster, parseDbName, parseHosts } from "./patlavaleHarness.js";

export const EXIT = Object.freeze({ OK: 0, ISSUES: 1, REFUSED: 2, INCONCLUSIVE: 3 });
export const SAMPLE_SIZE = 5;
const LABOUR_ID = /^L-(\d+)$/;

/** Command-line / environment guards. Returns { ok, dbName, host } or { ok: false, problem }. */
export const checkCensusGuards = ({ argv = [], env = {} } = {}) => {
  const opt = (name) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const refuse = (problem) => ({ ok: false, problem: `Refusing: ${problem}` });
  if (!argv.includes("--read-only-census")) return refuse("add --read-only-census (this script only reads, and only on the TEST database).");
  if (String(env.NODE_ENV ?? "").toLowerCase() === "production") return refuse("NODE_ENV is production. This script only works on a TEST database.");
  const dbName = parseDbName(env.MONGODB_URI);
  if (!dbName) return refuse("MONGODB_URI has no database name.");
  if (dbName !== EXPECTED_DB) return refuse(`the database name is "${dbName}", but this script is only for "${EXPECTED_DB}".`);
  if (opt("confirm-db") !== EXPECTED_DB) return refuse(`add --confirm-db ${EXPECTED_DB}.`);
  const parsed = parseHosts(env.MONGODB_URI);
  if (!parsed) return refuse("MONGODB_URI could not be read (host missing).");
  if (parsed.hosts.some((h) => !hostIsExpectedCluster(h))) return refuse(`the cluster host in MONGODB_URI is not the confirmed TEST cluster ${EXPECTED_CLUSTER_HOST}.`);
  if (opt("confirm-host") !== EXPECTED_CLUSTER_HOST) return refuse(`add --confirm-host ${EXPECTED_CLUSTER_HOST}.`);
  return { ok: true, dbName, host: EXPECTED_CLUSTER_HOST };
};

const isMoney = (v) => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const isPositiveMoney = (v) => isMoney(v) && v > 0;
const ids = (rows) => rows.slice(0, SAMPLE_SIZE).map((r) => String(r._id));
const finding = (key, title, rows, extra = {}) => ({ key, title, count: rows.length, sampleIds: ids(rows), ...extra });

/**
 * Runs every check. `read(name, filter)` returns an array of plain documents; names:
 * labours, rates, attendance, maap, production, payments, seasons, counters.
 */
export const runCensus = async (read) => {
  const [labours, rates, attendance, maap, production, payments, seasons, counters] = await Promise.all(
    ["labours", "rates", "attendance", "maap", "production", "payments", "seasons", "counters"].map((n) => read(n, {}))
  );
  const findings = [];

  // 1. documents missing isDeleted
  // Queries use { isDeleted: false }, so anything that is not exactly true or false (missing, null, "false", 0, ...) is excluded by them.
  // Only collections whose models use soft delete are checked. Labour and Season have no isDeleted field (they use status), so they are not checked.
  const noFlag = (rows) => rows.filter((r) => r.isDeleted !== true && r.isDeleted !== false);
  for (const [name, rows] of [["maapentries", maap], ["productionentries", production], ["payments", payments]]) {
    findings.push(finding(`missingIsDeleted.${name}`, `${name}: documents whose isDeleted is not exactly true or false (missing, null or invalid)`, noFlag(rows)));
  }

  // 2. missing or invalid money
  const badMoney = (rows, fields, positive = []) => rows.filter((r) => fields.some((f) => (positive.includes(f) ? !isPositiveMoney(r[f]) : !isMoney(r[f]))));
  findings.push(finding("badMoney.rates", "labourratehistories: ratePaise missing or not a positive whole number of paise", badMoney(rates, ["ratePaise"], ["ratePaise"])));
  findings.push(finding("badMoney.maap", "maapentries: ratePaise / earningsPaise missing or invalid", badMoney(maap, ["ratePaise", "earningsPaise"], ["ratePaise"])));
  findings.push(finding("badMoney.production", "productionentries: ratePaise / earningsPaise missing or invalid", badMoney(production, ["ratePaise", "earningsPaise"], ["ratePaise"])));
  findings.push(finding("badMoney.payments", "payments: amountPaise missing or not a positive whole number of paise", badMoney(payments, ["amountPaise"], ["amountPaise"])));

  // 3. workers without rate-history rows (and how much attendance depends on it)
  const rated = new Set(rates.map((r) => String(r.labourId)));
  const unrated = labours.filter((l) => !rated.has(String(l._id)));
  const attendanceByLabour = new Map();
  for (const a of attendance) attendanceByLabour.set(String(a.labourId), (attendanceByLabour.get(String(a.labourId)) ?? 0) + 1);
  findings.push(
    finding("noRateRows", "workers with no rate-history row", unrated, {
      sampleIds: unrated.slice(0, SAMPLE_SIZE).map((l) => String(l._id)),
      attendanceDaysAffected: unrated.reduce((t, l) => t + (attendanceByLabour.get(String(l._id)) ?? 0), 0),
    })
  );

  // 4. records dated before the worker's joining date (live records; Bayana may be earlier by rule)
  const joined = new Map(labours.map((l) => [String(l._id), l.joiningDate]));
  const before = (rows, key) => rows.filter((r) => typeof joined.get(String(r[key])) === "string" && typeof r.date === "string" && r.date < joined.get(String(r[key])));
  const live = (rows) => rows.filter((r) => r.isDeleted !== true);
  findings.push(finding("beforeJoining.attendance", "attendance dated before the worker's joining date", before(attendance, "labourId")));
  findings.push(finding("beforeJoining.maap", "maapentries (not deleted) dated before joining", before(live(maap), "labourId")));
  findings.push(finding("beforeJoining.production", "productionentries (not deleted) dated before joining", before(live(production), "teamId")));
  findings.push(finding("beforeJoining.payments", "payments (not deleted, not Bayana) dated before joining", before(live(payments).filter((p) => p.type !== "BOOKING_ADVANCE"), "recipientId")));
  const orphan = (rows, key) => rows.filter((r) => !joined.has(String(r[key])));
  findings.push(finding("orphans", "records whose worker id does not exist", [...orphan(attendance, "labourId"), ...orphan(maap, "labourId"), ...orphan(production, "teamId"), ...orphan(payments, "recipientId")]));

  // 5. labour id counter versus existing labour ids
  const numbers = labours.map((l) => LABOUR_ID.exec(String(l._id))).filter(Boolean).map((m) => Number(m[1]));
  const maxId = numbers.length ? Math.max(...numbers) : 0;
  const counter = counters.find((c) => String(c._id) === "labour");
  const seq = typeof counter?.seq === "number" ? counter.seq : null;
  const counterFinding = {
    key: "labourCounter",
    title: "labour id counter versus existing labour ids",
    count: seq === null || seq < maxId ? 1 : 0,
    sampleIds: [],
    counter: seq,
    highestLabourId: maxId,
    labourDocuments: labours.length,
    note: seq === null ? "no counter document: the next worker would restart at L-001" : seq < maxId ? "COUNTER IS BEHIND: the next worker id would collide with an existing one" : "ok (a counter ahead of the highest id is harmless: gaps are allowed)",
  };
  findings.push(counterFinding);

  return { findings, totals: { labours: labours.length, attendance: attendance.length, maap: maap.length, production: production.length, payments: payments.length }, issues: findings.filter((f) => f.count > 0).length };
};

export const formatCensus = (result, { dbName, host }) => {
  const lines = [`Read-only census of ${dbName} on ${host} (nothing was written)`, `Documents read: ${JSON.stringify(result.totals)}`, ""];
  for (const f of result.findings) {
    lines.push(`${f.count === 0 ? "OK   " : "FOUND"} ${f.title}: ${f.count}`);
    if (f.count > 0 && f.sampleIds.length) lines.push(`        sample ids: ${f.sampleIds.join(", ")}`);
    if (f.attendanceDaysAffected !== undefined && f.count > 0) lines.push(`        attendance days with no rate to price them: ${f.attendanceDaysAffected}`);
    if (f.key === "labourCounter") lines.push(`        counter=${f.counter ?? "none"}, highest labour id number=${f.highestLabourId}, labour documents=${f.labourDocuments}; ${f.note}`);
  }
  lines.push("", result.issues === 0 ? "RESULT: no issues found." : `RESULT: ${result.issues} kind(s) of issue found. Nothing was changed. Any repair needs a separate approval.`);
  return lines;
};
