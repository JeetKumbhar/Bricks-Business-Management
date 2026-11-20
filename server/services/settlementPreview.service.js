import { LABOUR_STATUS, LABOUR_TYPES } from "../constants/labour.js";
import Labour from "../models/Labour.js";
import ApiError from "../utils/ApiError.js";
import { addDays, todayBusinessDate } from "../utils/dates.js";
import { paiseToRupees, sumPaise } from "../utils/money.js";
import { LINE_KINDS, buildLedger, summarizeAccount } from "./salaryCalculations.js";
import { loadSources } from "./salary.service.js";
import { listSeasonRows, loadSeason } from "./season.service.js";

// Season closing PREVIEW (S1). READ ONLY: it reads work, rates, payments and seasons and never writes anything, so asking for a preview
// cannot change work, production, payments or seasons. It does NOT calculate earnings itself: every figure comes from the same ledger the
// Salary page uses (buildLedger / summarizeAccount), so Bigari (attendance x the rate in force each day), Maapvali (stored per-entry earnings,
// per 4 maaps) and Patlavale (stored per-entry earnings, 4 maaps = 1,000 payable bricks) each keep their own rules.
//
// A season is a date window over the all-time ledger [startDate, endDate]:
//   opening  = everything before the start (earlier history, earlier carried balances)
//   closing  = opening + earned in the season - received in the season           (positive = owed to the worker; negative = paid more than earned)
// Settlement rules (agreed): a positive closing is PAYABLE and is settled by real, traceable settlement payments; a negative closing is
// RECOVERABLE and must be explicitly CARRIED FORWARD as an opening advance (never written off, erased or treated as settled). The ledger date of
// settlement payments is the season end date; the actual payment date is kept separately. The next season must start the day after this one ends.

const rupees = (p) => paiseToRupees(p);
const sum = (list, pick) => sumPaise(list.map(pick));

export const STATEMENT_STATUS = Object.freeze({ PAYABLE: "PAYABLE", RECOVERABLE: "RECOVERABLE", ZERO: "ZERO" });
export const BLOCKERS = Object.freeze({ MISSING_RATE: "MISSING_RATE", NEXT_SEASON_START: "NEXT_SEASON_START", END_BEFORE_START: "END_BEFORE_START", END_IN_FUTURE: "END_IN_FUTURE" });

const fieldError = (status, message, field) => new ApiError(status, message, [{ field, message }]);

/** One worker's closing statement for [start, end], from that worker's ledger lines. Pure. */
export const settlementStatement = (labour, lines, { start, end }) => {
  const a = summarizeAccount(labour.labourType, lines, start, end);
  const closing = a.closingPaise;
  const missingRateDays = lines.filter((l) => l.kind === LINE_KINDS.ATTENDANCE && l.rateMissing && l.date <= end).length;
  const after = lines.filter((l) => l.date > end);
  const status = closing > 0 ? STATEMENT_STATUS.PAYABLE : closing < 0 ? STATEMENT_STATUS.RECOVERABLE : STATEMENT_STATUS.ZERO;
  const payablePaise = Math.max(closing, 0);
  const recoverablePaise = Math.max(-closing, 0);
  return {
    labourId: String(labour._id),
    name: labour.name,
    labourType: labour.labourType,
    labourStatus: labour.status,
    status,
    openingPaise: a.openingPaise,
    earnedPaise: a.period.earnedPaise,
    bayanaPaise: a.period.bayanaPaise,
    salaryPaise: a.period.salaryPaise,
    otherPaise: a.period.otherPaise,
    receivedPaise: a.period.receivedPaise,
    closingPaise: closing,
    payablePaise,
    recoverablePaise,
    work: a.period.work,
    workLines: lines.filter((l) => l.kind !== LINE_KINDS.PAYMENT && l.date >= start && l.date <= end).length,
    paymentLines: lines.filter((l) => l.kind === LINE_KINDS.PAYMENT && l.date >= start && l.date <= end).length,
    missingRateDays,
    // Dated after the season end: not in this statement; they belong to whatever season (or gap) covers their date.
    afterEnd: { lines: after.length, firstDate: after[0]?.date ?? null },
    // What happens to the balance. Nothing is written off or silently moved.
    resolution:
      status === STATEMENT_STATUS.PAYABLE
        ? { kind: "SETTLE_BY_PAYMENT", amountPaise: payablePaise }
        : status === STATEMENT_STATUS.RECOVERABLE
          ? { kind: "CARRY_FORWARD_AS_OPENING_ADVANCE", amountPaise: recoverablePaise, requiresExplicitDecision: true }
          : { kind: "NONE", amountPaise: 0 },
  };
};

const statementDto = ({ openingPaise, earnedPaise, bayanaPaise, salaryPaise, otherPaise, receivedPaise, closingPaise, payablePaise, recoverablePaise, resolution, ...rest }) => ({
  ...rest,
  opening: rupees(openingPaise),
  earned: rupees(earnedPaise),
  bayana: rupees(bayanaPaise),
  salaryPayments: rupees(salaryPaise),
  otherPayments: rupees(otherPaise),
  received: rupees(receivedPaise),
  closing: rupees(closingPaise),
  payable: rupees(payablePaise),
  recoverable: rupees(recoverablePaise),
  resolution: { ...resolution, amount: rupees(resolution.amountPaise) },
  _paise: { openingPaise, earnedPaise, bayanaPaise, salaryPaise, otherPaise, receivedPaise, closingPaise, payablePaise, recoverablePaise },
});

// A worker is in the preview when they have any record up to the end date, or are an active worker who had joined by then.
const included = (labour, lines, end) => lines.some((l) => l.date <= end) || (labour.status === LABOUR_STATUS.ACTIVE && labour.joiningDate <= end);

const typeTotals = (type, items) => {
  const list = items.filter((s) => s.labourType === type);
  return {
    type,
    workers: list.length,
    payableWorkers: list.filter((s) => s.status === STATEMENT_STATUS.PAYABLE).length,
    recoverableWorkers: list.filter((s) => s.status === STATEMENT_STATUS.RECOVERABLE).length,
    zeroWorkers: list.filter((s) => s.status === STATEMENT_STATUS.ZERO).length,
    opening: rupees(sum(list, (s) => s.openingPaise)),
    earned: rupees(sum(list, (s) => s.earnedPaise)),
    received: rupees(sum(list, (s) => s.receivedPaise)),
    closing: rupees(sum(list, (s) => s.closingPaise)),
    payable: rupees(sum(list, (s) => s.payablePaise)),
    recoverable: rupees(sum(list, (s) => s.recoverablePaise)),
  };
};

/**
 * The whole preview. Pure: everything it needs is passed in.
 * `season` and `seasons` are plain rows; `labours` rows; `sourceFor(labour)` gives that worker's source records; `today` is a business date.
 */
export const buildSettlementPreview = ({ season, seasons, labours, sourceFor, endDate, today }) => {
  const start = season.startDate;
  const end = endDate ?? season.endDate ?? today;
  const blockers = [];
  const warnings = [];

  if (end < start) blockers.push({ code: BLOCKERS.END_BEFORE_START, message: `The end date ${end} is before the season start ${start}.` });
  if (end > today) blockers.push({ code: BLOCKERS.END_IN_FUTURE, message: `The end date ${end} is in the future (today is ${today}). A season can only be closed on or after its last day.` });

  // The next season must begin the day after this one ends.
  const later = seasons.filter((s) => String(s._id) !== String(season._id) && s.startDate > start).sort((a, b) => a.startDate.localeCompare(b.startDate))[0] ?? null;
  const expectedNextStart = addDays(end, 1);
  if (later && later.startDate !== expectedNextStart) {
    blockers.push({
      code: BLOCKERS.NEXT_SEASON_START,
      message: `The next season "${later.name}" starts on ${later.startDate}, but it must start the day after this season ends (${expectedNextStart}). Change the end date or fix that season's start first.`,
    });
  }

  const everyone = labours.map((l) => ({ labour: l, lines: buildLedger(l, sourceFor(l)) }));
  const rows = everyone.filter(({ labour, lines }) => included(labour, lines, end));
  const statements = rows.map(({ labour, lines }) => statementDto(settlementStatement(labour, lines, { start, end }))).sort((a, b) => a.labourId.localeCompare(b.labourId));

  const missing = statements.filter((s) => s.missingRateDays > 0);
  if (missing.length > 0) {
    blockers.push({
      code: BLOCKERS.MISSING_RATE,
      message: `${missing.length} Bigari worker(s) have attendance days with no rate, so their earnings would be understated. Add the missing rate first.`,
      labourIds: missing.map((s) => s.labourId),
    });
  }
  const afterEnd = statements.filter((s) => s.afterEnd.lines > 0);
  if (afterEnd.length > 0) {
    warnings.push({ code: "ACTIVITY_AFTER_END", message: `${afterEnd.length} worker(s) have records dated after ${end}. They are not in this statement and count in the next season.`, labourIds: afterEnd.map((s) => s.labourId) });
  }
  const recoverable = statements.filter((s) => s.status === STATEMENT_STATUS.RECOVERABLE);
  if (recoverable.length > 0) {
    warnings.push({ code: "NEGATIVE_BALANCES", message: `${recoverable.length} worker(s) were paid more than they earned. Each needs an explicit carry-forward decision; it becomes an opening advance in the next season.`, labourIds: recoverable.map((s) => s.labourId) });
  }
  const alreadyClosed = season.status === "CLOSED";
  if (alreadyClosed) warnings.push({ code: "ALREADY_CLOSED", message: "This season is already marked CLOSED. This preview is informational; no settlement record exists yet." });

  const items = statements.map(({ _paise, ...s }) => ({ ...s, _paise }));
  const plain = items.map(({ _paise, ...s }) => s);
  const byType = [LABOUR_TYPES.BIGARI, LABOUR_TYPES.MAAPVALI, LABOUR_TYPES.PATLAVALE].map((t) => typeTotals(t, items.map((s) => ({ ...s, ...s._paise }))));
  const flat = items.map((s) => s._paise);
  return {
    season: { id: String(season._id), name: season.name, status: season.status, startDate: start, endDate: season.endDate ?? null },
    proposedEndDate: end,
    ledgerDateForSettlementPayments: end, // the books date; the actual payment date is recorded separately
    nextSeasonMustStartOn: expectedNextStart,
    readyToClose: blockers.length === 0,
    blockers,
    warnings,
    items: plain,
    summary: {
      workers: plain.length,
      payableWorkers: plain.filter((s) => s.status === STATEMENT_STATUS.PAYABLE).length,
      recoverableWorkers: recoverable.length,
      zeroWorkers: plain.filter((s) => s.status === STATEMENT_STATUS.ZERO).length,
      opening: rupees(sum(flat, (p) => p.openingPaise)),
      earned: rupees(sum(flat, (p) => p.earnedPaise)),
      received: rupees(sum(flat, (p) => p.receivedPaise)),
      payable: rupees(sum(flat, (p) => p.payablePaise)),
      recoverable: rupees(sum(flat, (p) => p.recoverablePaise)),
      byType,
    },
    notIncluded: everyone.length - rows.length, // inactive or not-yet-joined workers with no record up to the end date
  };
};

/** GET /api/seasons/:id/settlement-preview[?endDate=YYYY-MM-DD]. Reads only. */
export const getSettlementPreview = async (seasonId, { endDate } = {}, now = new Date()) => {
  const season = await loadSeason(seasonId);
  const today = todayBusinessDate(now);
  if (endDate && endDate < season.startDate) throw fieldError(400, `endDate must be on or after the season start (${season.startDate})`, "endDate");
  const [seasons, labours] = await Promise.all([listSeasonRows(), Labour.find({}).lean()]);
  labours.sort((a, b) => String(a._id).localeCompare(String(b._id)));
  const sourceFor = await loadSources(labours);
  return buildSettlementPreview({ season, seasons, labours, sourceFor, endDate, today });
};
