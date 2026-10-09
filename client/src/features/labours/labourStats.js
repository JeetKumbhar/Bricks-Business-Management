// Pure functions that turn raw records into the numbers shown in the UI.
// Rules: docs/BUSINESS_RULES.md
//   earned  = sum of (attendance units x the rate in force on that day)
//   balance = earned - total received      (negative = overpaid, shown in red)
import { ATTENDANCE_STATUS, ATTENDANCE_UNITS } from "../../utils/attendanceStatus";
import { toISODate } from "../../utils/formatDate";
import { PAYMENT_TYPES } from "../../utils/paymentTypes";

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
