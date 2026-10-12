// Pure functions that turn raw records into the numbers shown in the UI.
// Rules: docs/BUSINESS_RULES.md
//   earned  = sum of (attendance units x the rate in force on that day)
//   balance = earned - total received      (negative = overpaid, shown in red)
import { ATTENDANCE_STATUS, ATTENDANCE_UNITS } from "../../utils/attendanceStatus";
import { toISODate } from "../../utils/formatDate";
import { LABOUR_TYPES } from "../../utils/labourTypes";
import { PAYMENT_TYPES } from "../../utils/paymentTypes";
import { summarizeProduction } from "../../utils/productionCalculations";

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

export const buildLabourStats = (labour, records = [], payments = [], ratesAsc = [], today = toISODate()) => {
  const attendance = enrichAttendance(records, ratesAsc);
  const countOf = (status) => attendance.filter((r) => r.status === status).length;

  const livePayments = payments.filter((p) => !p.isDeleted);
  const sumOf = (type) => livePayments.filter((p) => p.type === type).reduce((total, p) => total + p.amount, 0);

  const bookingAdvance = sumOf(PAYMENT_TYPES.BOOKING_ADVANCE);
  const salaryPayments = sumOf(PAYMENT_TYPES.SALARY_PAYMENT);
  const otherPayments = sumOf(PAYMENT_TYPES.OTHER);
  const totalReceived = bookingAdvance + salaryPayments + otherPayments;
  const earned = attendance.reduce((total, r) => total + r.earned, 0);

  return {
    ...labour,
    dailyRate: rateAt(ratesAsc, today) || labour.dailyRate,
    presentDays: countOf(ATTENDANCE_STATUS.PRESENT),
    halfDays: countOf(ATTENDANCE_STATUS.HALF_DAY),
    absentDays: countOf(ATTENDANCE_STATUS.ABSENT),
    workingUnits: attendance.reduce((total, r) => total + r.units, 0),
    earned,
    bookingAdvance,
    salaryPayments,
    otherPayments,
    totalReceived,
    balance: earned - totalReceived,
  };
};

// ---------------------------------------------------------------------------
// Maapvali and Patlavale (PROTOTYPE calculations; final financial calculations belong to the backend)
//   Maapvali  earned = sum of maap entry earnings (numberOfMaaps x ratePerMaap)
//   Patlavale earned = sum of production entry newEarnings (payable bricks / 1000 x team rate)
//   balance   = earned - total received
// Attendance is not used for either type. Until the client confirms how Bayana and "Other" payments are
// treated, every payment type counts as received (see docs/BUSINESS_RULES.md, open questions).
// ---------------------------------------------------------------------------

/** Totals of the payments that are not deleted. */
export const summarizePayments = (payments = []) => {
  const live = payments.filter((p) => !p.isDeleted);
  const sumOf = (type) => live.filter((p) => p.type === type).reduce((total, p) => total + p.amount, 0);
  const bookingAdvance = sumOf(PAYMENT_TYPES.BOOKING_ADVANCE);
  const salaryPayments = sumOf(PAYMENT_TYPES.SALARY_PAYMENT);
  const otherPayments = sumOf(PAYMENT_TYPES.OTHER);
  return { bookingAdvance, salaryPayments, otherPayments, totalReceived: bookingAdvance + salaryPayments + otherPayments };
};

export const buildMaapvaliStats = (worker, entries = [], payments = []) => {
  const earned = entries.reduce((total, e) => total + e.earnings, 0);
  const paid = summarizePayments(payments);
  return {
    ...worker,
    totalMaaps: entries.reduce((total, e) => total + e.numberOfMaaps, 0),
    workDays: entries.length,
    earned,
    ...paid,
    balance: earned - paid.totalReceived,
  };
};

export const buildPatlavaleStats = (team, entries = [], payments = []) => {
  const ledger = [...entries].sort((a, b) => a.date.localeCompare(b.date));
  const production = summarizeProduction(ledger);
  const paid = summarizePayments(payments);
  return {
    ...team,
    // Physical, payable and carry-forward bricks are kept as separate values.
    totalPhysicalBricks: production.totalPhysicalBricks,
    totalPayableBricks: production.totalPayableBricks,
    carryForwardBricks: production.carryForwardBricks,
    productionDays: ledger.length,
    earned: production.totalEarnings,
    ...paid,
    balance: production.totalEarnings - paid.totalReceived,
  };
};

/** One entry point for any labour record. data: { attendance, maap, production, payments, rates } */
export const buildWorkerStats = (worker, data = {}) => {
  if (worker.labourType === LABOUR_TYPES.MAAPVALI) return buildMaapvaliStats(worker, data.maap, data.payments);
  if (worker.labourType === LABOUR_TYPES.PATLAVALE) return buildPatlavaleStats(worker, data.production, data.payments);
  return buildLabourStats(worker, data.attendance, data.payments, data.rates);
};
