import { ACCOUNTING_POLICY } from "../constants/payments.js";
import { SEASON_STATUS } from "../constants/production.js";
import Labour from "../models/Labour.js";
import ProductionEntry from "../models/ProductionEntry.js";
import Season from "../models/Season.js";
import SeasonSettlement from "../models/SeasonSettlement.js";
import SettlementStatement from "../models/SettlementStatement.js";
import ApiError from "../utils/ApiError.js";
import { todayBusinessDate } from "../utils/dates.js";
import { paiseToRupees, sumPaise } from "../utils/money.js";
import { runInTransaction } from "../utils/transaction.js";
import { loadSources } from "./salary.service.js";
import { computeSettlement } from "./settlementPreview.service.js";

// Season closing (S2). ONE all-or-nothing transaction that
//   1. guards the season (still OPEN, and still at the revision the Owner previewed): this is also the first write, so a production save that
//      commits first makes it fail (409) and a close that commits first makes that production save fail;
//   2. recalculates every worker's statement INSIDE the transaction from the same ledger the preview uses (one consistent snapshot);
//   3. refuses if anything blocks the close (missing rates, next season not starting the day after, a future end date);
//   4. writes ONE SeasonSettlement and one immutable SettlementStatement per included worker, then marks the season CLOSED.
// It never records a worker payment, and it never writes attendance, Maapvali, production or payment records. A negative balance is stored as
// RECOVERABLE and requiring the Owner's explicit carry-forward decision; it is not settled, zeroed or written off here.

export const SETTLEMENT_SCHEMA_VERSION = 1;

const fieldError = (status, message, field) => new ApiError(status, message, [{ field, message }]);
const isDuplicateKey = (err) => err?.code === 11000;
const inSession = (query, session) => (session ? query.session(session) : query);

const rupeesOf = (row, keys) => Object.fromEntries(keys.map((k) => [k.replace(/Paise$/, ""), paiseToRupees(row[k])]));
const STATEMENT_MONEY = ["openingPaise", "earnedPaise", "bayanaPaise", "salaryPaise", "otherPaise", "receivedPaise", "closingPaise", "payablePaise", "recoverablePaise"];
const TOTAL_MONEY = ["openingPaise", "earnedPaise", "receivedPaise", "payablePaise", "recoverablePaise"];

export const toSettlementDto = (row) => ({
  id: String(row._id),
  seasonId: row.seasonId,
  seasonName: row.seasonName,
  startDate: row.startDate,
  endDate: row.endDate,
  ledgerDate: row.ledgerDate,
  closedAt: row.closedAt,
  closedBy: row.closedBy,
  seasonRevisionBefore: row.seasonRevisionBefore,
  schemaVersion: row.schemaVersion,
  policy: row.policy,
  totals: { ...row.totals, ...rupeesOf(row.totals, TOTAL_MONEY) },
  warnings: row.warnings ?? [],
  notIncluded: row.notIncluded ?? 0,
});

export const toStatementDto = (row) => ({
  id: String(row._id),
  settlementId: row.settlementId,
  seasonId: row.seasonId,
  labourId: row.labourId,
  name: row.name,
  labourType: row.labourType,
  labourStatus: row.labourStatus,
  status: row.status,
  ...Object.fromEntries(STATEMENT_MONEY.map((k) => [k, row[k]])),
  ...rupeesOf(row, STATEMENT_MONEY),
  work: row.work,
  workLines: row.workLines,
  paymentLines: row.paymentLines,
  openingLineCount: row.openingLineCount,
  afterEnd: row.afterEnd,
  missingRateDays: row.missingRateDays ?? 0,
  resolution: row.resolution,
  lines: row.lines ?? [],
});

/** The statement document for one worker, from the calculated statement (exact paise and source lines). */
const statementDoc = (s, { seasonId, settlementId }) => ({
  settlementId,
  seasonId,
  labourId: s.labourId,
  name: s.name,
  labourType: s.labourType,
  labourStatus: s.labourStatus,
  status: s.status,
  ...Object.fromEntries(STATEMENT_MONEY.map((k) => [k, s._paise[k]])),
  work: s.work,
  workLines: s.workLines,
  paymentLines: s.paymentLines,
  openingLineCount: s.openingLineCount,
  afterEnd: s.afterEnd,
  missingRateDays: s.missingRateDays,
  resolution: s.resolution, // RECOVERABLE keeps requiresExplicitDecision: true
  lines: s._lines,
});

/**
 * POST /api/seasons/:id/close  { endDate, revision }. Returns the settlement (and its statements' summary). 409 on any conflict; nothing is saved then.
 */
export const closeSeason = async (seasonId, { endDate, revision }, actor, now = new Date()) => {
  const today = todayBusinessDate(now);
  await runInTransaction(
    async (session) => {
      const [season] = await inSession(Season.find({ _id: seasonId }), session).lean();
      if (!season) throw ApiError.notFound("Season not found");
      if (season.status !== SEASON_STATUS.OPEN) throw fieldError(409, `${season.name} is already closed. A closed season cannot be closed again.`, "status");
      if ((season.revision ?? 1) !== revision) throw ApiError.conflict("This season changed since you previewed it (for example production was saved). Preview it again before closing.");
      if ((await inSession(SeasonSettlement.find({ seasonId: String(season._id) }), session).lean()).length > 0) throw fieldError(409, "This season already has a settlement record.", "status");

      // The first write: only matches while the season is still OPEN at the confirmed revision.
      const guard = await Season.updateOne(
        { _id: season._id, status: SEASON_STATUS.OPEN, revision },
        { $set: { status: SEASON_STATUS.CLOSED, endDate, updatedBy: actor?.id ?? null }, $inc: { revision: 1 } },
        session ? { session } : undefined
      );
      if (guard.matchedCount !== 1) throw ApiError.conflict("This season was changed or closed by someone else while closing. Nothing was saved; preview it again.");

      // Closing must never leave production outside its own season's dates (the same rule as editing the dates).
      const stranded = (await inSession(ProductionEntry.find({ seasonId: String(season._id) }), session).lean()).filter((e) => e.date > endDate);
      if (stranded.length > 0) throw fieldError(409, `${stranded.length} production entr${stranded.length === 1 ? "y is" : "ies are"} dated after ${endDate} (for example ${stranded[0].date}). Choose a later end date.`, "endDate");

      const [seasons, labours] = await Promise.all([inSession(Season.find({}), session).lean(), inSession(Labour.find({}), session).lean()]);
      labours.sort((a, b) => String(a._id).localeCompare(String(b._id)));
      const sourceFor = await loadSources(labours, session);
      const calc = computeSettlement({ season, seasons, labours, sourceFor, endDate, today });
      if (!calc.preview.readyToClose) {
        throw new ApiError(409, "The season cannot be closed yet", calc.preview.blockers.map((b) => ({ field: "endDate", message: b.message, code: b.code })));
      }

      const flat = calc.statements.map((s) => s._paise);
      const [settlement] = await SeasonSettlement.insertMany(
        [
          {
            seasonId: String(season._id),
            seasonName: season.name,
            startDate: season.startDate,
            endDate,
            ledgerDate: endDate,
            closedAt: now,
            closedBy: { id: actor?.id ?? null, name: actor?.name ?? null },
            seasonRevisionBefore: revision,
            schemaVersion: SETTLEMENT_SCHEMA_VERSION,
            policy: { ...ACCOUNTING_POLICY },
            totals: {
              workers: flat.length,
              payableWorkers: calc.statements.filter((s) => s.status === "PAYABLE").length,
              recoverableWorkers: calc.statements.filter((s) => s.status === "RECOVERABLE").length,
              zeroWorkers: calc.statements.filter((s) => s.status === "ZERO").length,
              openingPaise: sumPaise(flat.map((p) => p.openingPaise)),
              earnedPaise: sumPaise(flat.map((p) => p.earnedPaise)),
              receivedPaise: sumPaise(flat.map((p) => p.receivedPaise)),
              payablePaise: sumPaise(flat.map((p) => p.payablePaise)),
              recoverablePaise: sumPaise(flat.map((p) => p.recoverablePaise)),
            },
            warnings: calc.preview.warnings.map(({ code, message, labourIds }) => ({ code, message, ...(labourIds ? { labourIds } : {}) })),
            notIncluded: calc.preview.notIncluded,
          },
        ],
        session ? { session } : undefined
      );
      const settlementId = String(settlement._id);
      if (calc.statements.length > 0) {
        await SettlementStatement.insertMany(calc.statements.map((s) => statementDoc(s, { seasonId: String(season._id), settlementId })), session ? { session } : undefined);
      }
      return { settlementId, statements: calc.statements.length };
    },
    { required: true }
  ).catch((err) => {
    if (isDuplicateKey(err)) throw fieldError(409, "This season already has a settlement record (it was closed at the same moment).", "status");
    throw err;
  });
  return getSettlement(seasonId);
};

/** The stored settlement and every worker's permanent statement. Reads only. */
export const getSettlement = async (seasonId) => {
  const [season] = await Season.find({ _id: seasonId }).lean();
  if (!season) throw ApiError.notFound("Season not found");
  const [settlement] = await SeasonSettlement.find({ seasonId: String(season._id) }).lean();
  if (!settlement) throw ApiError.notFound("This season has no settlement record (it has not been closed through the settlement process)");
  const statements = (await SettlementStatement.find({ seasonId: String(season._id) }).lean()).sort((a, b) => a.labourId.localeCompare(b.labourId));
  return { settlement: toSettlementDto(settlement), statements: statements.map(toStatementDto) };
};
