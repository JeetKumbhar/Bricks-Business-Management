// Pure functions that turn raw records into the numbers shown in the UI.
// The money maths (earnings, received, balance) lives in utils/accountCalculations.js; this file prepares
// each type's records and adds the display fields. Rules: docs/BUSINESS_RULES.md
import { buildAccount, summarizeTransactions } from "../../utils/accountCalculations";
import { ATTENDANCE_STATUS, ATTENDANCE_UNITS } from "../../utils/attendanceStatus";
import { toISODate } from "../../utils/formatDate";
import { LABOUR_TYPES } from "../../utils/labourTypes";

export const groupBy = (items, key) =>
  items.reduce((groups, item) => {
    (groups[item[key]] ||= []).push(item);
    return groups;
  }, {});

export const sortRatesAsc = (rates = []) => [...rates].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));

/** Rate in force on `date`. `ratesAsc` must be sorted oldest first. */
export const rateAt = (ratesAsc, date) => {
  let current = ratesAsc[0]?.rate ?? 0;
  for (const entry of ratesAsc) {
    if (entry.effectiveFrom <= date) current = entry.rate;
    else break;
  }
  return current;
};

/** Adds units / rate / earned to every attendance record. */
export const enrichAttendance = (records = [], ratesAsc = []) =>
  records.map((record) => {
    const units = ATTENDANCE_UNITS[record.status] ?? 0;
    const rate = rateAt(ratesAsc, record.date);
    return { ...record, units, rate, earned: units * rate };
  });

/** Bigari: earnings come from attendance and rate history. */
export const buildLabourStats = (labour, records = [], payments = [], ratesAsc = [], today = toISODate()) => {
  const attendance = enrichAttendance(records, ratesAsc);
  const countOf = (status) => attendance.filter((r) => r.status === status).length;
  const account = buildAccount({ labourType: LABOUR_TYPES.BIGARI, attendance, payments });

  return {
    ...labour,
    dailyRate: rateAt(ratesAsc, today) || labour.dailyRate,
    presentDays: countOf(ATTENDANCE_STATUS.PRESENT),
    halfDays: countOf(ATTENDANCE_STATUS.HALF_DAY),
    absentDays: countOf(ATTENDANCE_STATUS.ABSENT),
    ...account,
  };
};

/** Kept for older imports: totals of the payment transactions. */
export const summarizePayments = summarizeTransactions;

/** Maapvali: earnings come from maap work entries. */
export const buildMaapvaliStats = (worker, entries = [], payments = []) => ({
  ...worker,
  ...buildAccount({ labourType: LABOUR_TYPES.MAAPVALI, maapEntries: entries, payments }),
});

/** Patlavale team: earnings come from payable production units. */
export const buildPatlavaleStats = (team, entries = [], payments = []) => ({
  ...team,
  ...buildAccount({ labourType: LABOUR_TYPES.PATLAVALE, productionEntries: entries, payments }),
});

/** One entry point for any labour record. data: { attendance, maap, production, payments, rates } */
export const buildWorkerStats = (worker, data = {}) => {
  if (worker.labourType === LABOUR_TYPES.MAAPVALI) return buildMaapvaliStats(worker, data.maap, data.payments);
  if (worker.labourType === LABOUR_TYPES.PATLAVALE) return buildPatlavaleStats(worker, data.production, data.payments);
  return buildLabourStats(worker, data.attendance, data.payments, data.rates);
};
