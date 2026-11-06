// Pure salary calculations (no database). The ONE place that turns source records into a salary account, so the Salary
// summary, the per-labour statement and the balance all agree.
//
// Every record becomes one LEDGER LINE that points back at its source (sourceId):
//   Bigari    attendance day   earned = units x the daily rate in force that day         (rate history, by date)
//   Maapvali  maap entry       earned = the entry's stored earnings (maaps / 4 x its own rate snapshot)
//   Patlavale production entry earned = the entry's stored earnings (maaps / 4 x its own rate snapshot)
//   Payment   (any type)       received = the amount, if ACCOUNTING_POLICY counts that type; voided payments are not lines at all
//
//   balance = earned - received          (negative = paid more than earned)
//
// Each record is one line and is counted once, so nothing can be double-counted: Bayana is just a payment line, never
// subtracted again as a separate "advance". Payments have earned = 0 and work lines have received = 0, so a payment can
// never change an earned amount. Amounts are integer paise and are only ever added, never rounded here.
import { ATTENDANCE_STATUS, ATTENDANCE_UNITS } from "../constants/attendance.js";
import { LABOUR_TYPES } from "../constants/labour.js";
import { ACCOUNTING_POLICY, PAYMENT_TYPES, countsAsReceived } from "../constants/payments.js";
import { physicalBricksForMaaps, sumPaise } from "../utils/money.js";
import { earnedPaiseFor } from "./attendance.service.js";
import { ratePaiseAt, sortRatesAsc } from "./labourRates.js";

export const LINE_KINDS = Object.freeze({ ATTENDANCE: "ATTENDANCE", MAAP: "MAAP", PRODUCTION: "PRODUCTION", PAYMENT: "PAYMENT" });
const KIND_ORDER = { ATTENDANCE: 0, MAAP: 0, PRODUCTION: 0, PAYMENT: 1 }; // on one day, work comes before money

/** Source records for one labour: { attendance, rates, maap, production, payments } (rows as stored; deleted ones already left out). */
export const buildLedger = (labour, { attendance = [], rates = [], maap = [], production = [], payments = [] } = {}, policy = ACCOUNTING_POLICY) => {
  const ratesAsc = sortRatesAsc(rates);
  const work =
    labour.labourType === LABOUR_TYPES.MAAPVALI
      ? maap.map((r) => ({ kind: LINE_KINDS.MAAP, date: r.date, sourceId: String(r._id), maaps: r.numberOfMaaps, ratePaise: r.ratePaise, earnedPaise: r.earningsPaise }))
      : labour.labourType === LABOUR_TYPES.PATLAVALE
        ? production.map((r) => ({ kind: LINE_KINDS.PRODUCTION, date: r.date, sourceId: String(r._id), maaps: r.numberOfMaaps, payableBricks: r.payableBricks, ratePaise: r.ratePaise, earnedPaise: r.earningsPaise }))
        : attendance.map((r) => {
            const ratePaise = ratePaiseAt(ratesAsc, r.date);
            return { kind: LINE_KINDS.ATTENDANCE, date: r.date, sourceId: String(r._id), status: r.status, units: ATTENDANCE_UNITS[r.status], ratePaise, earnedPaise: earnedPaiseFor(r.status, ratePaise) ?? 0 };
          });
  const money = payments
    .filter((p) => !p.isDeleted)
    .map((p) => ({ kind: LINE_KINDS.PAYMENT, date: p.date, sourceId: String(p._id), paymentType: p.type, method: p.method, amountPaise: p.amountPaise, receivedPaise: countsAsReceived(p.type, policy) ? p.amountPaise : 0, earnedPaise: 0 }));
  return [...work.map((l) => ({ receivedPaise: 0, ...l })), ...money].sort((a, b) => a.date.localeCompare(b.date) || KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.sourceId.localeCompare(b.sourceId));
};

const total = (lines, key) => sumPaise(lines.map((l) => l[key] ?? 0));

/** What was done in the lines, by type: days for Bigari, maaps for Maapvali, maaps and bricks for Patlavale. */
export const summarizeWork = (labourType, lines) => {
  const work = lines.filter((l) => l.kind !== LINE_KINDS.PAYMENT);
  if (labourType === LABOUR_TYPES.MAAPVALI) return { maaps: work.reduce((t, l) => t + l.maaps, 0), workDays: work.length };
  if (labourType === LABOUR_TYPES.PATLAVALE) {
    const maaps = work.reduce((t, l) => t + l.maaps, 0);
    return { maaps, physicalBricks: physicalBricksForMaaps(maaps), payableBricks: work.reduce((t, l) => t + l.payableBricks, 0), entries: work.length };
  }
  const count = (status) => work.filter((l) => l.status === status).length;
  return { presentDays: count(ATTENDANCE_STATUS.PRESENT), halfDays: count(ATTENDANCE_STATUS.HALF_DAY), absentDays: count(ATTENDANCE_STATUS.ABSENT), workingUnits: work.reduce((t, l) => t + l.units, 0) };
};

/**
 * The account of one labour for the range [from, to] (inclusive; from "0000-01-01" means from the beginning):
 *   opening   balance before `from`            period    what happened inside the range
 *   closing   opening + earned - received      toDate    everything, whatever the range (the frontend's "season to date")
 * closing is the balance as of `to`, and always equals opening + period.earned - period.received.
 */
export const summarizeAccount = (labourType, lines, from, to) => {
  const before = lines.filter((l) => l.date < from);
  const inRange = lines.filter((l) => l.date >= from && l.date <= to);
  const pays = (type) => inRange.filter((l) => l.kind === LINE_KINDS.PAYMENT && l.paymentType === type);
  const openingPaise = total(before, "earnedPaise") - total(before, "receivedPaise");
  const period = {
    earnedPaise: total(inRange, "earnedPaise"),
    receivedPaise: total(inRange, "receivedPaise"),
    bayanaPaise: total(pays(PAYMENT_TYPES.BOOKING_ADVANCE), "amountPaise"),
    salaryPaise: total(pays(PAYMENT_TYPES.SALARY_PAYMENT), "amountPaise"),
    otherPaise: total(pays(PAYMENT_TYPES.OTHER), "amountPaise"),
    paidPaise: total(inRange.filter((l) => l.kind === LINE_KINDS.PAYMENT), "amountPaise"),
    work: summarizeWork(labourType, inRange),
  };
  const toDate = { earnedPaise: total(lines, "earnedPaise"), receivedPaise: total(lines, "receivedPaise") };
  toDate.balancePaise = toDate.earnedPaise - toDate.receivedPaise;
  return { openingPaise, period, closingPaise: openingPaise + period.earnedPaise - period.receivedPaise, toDate };
};

/** The lines inside the range with a running balance that starts at the opening balance. */
export const withRunningBalance = (lines, from, to, openingPaise) => {
  let running = openingPaise;
  return lines
    .filter((l) => l.date >= from && l.date <= to)
    .map((l) => {
      running += l.earnedPaise - l.receivedPaise;
      return { ...l, balancePaise: running };
    });
};
