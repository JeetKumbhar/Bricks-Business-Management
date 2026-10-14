// ACCOUNT CALCULATION LAYER (PROTOTYPE - final financial calculations belong to the backend)
//
// One place that answers, for any labour record (Bigari, Maapvali or Patlavale team):
//   total earnings   - from that type's own work records
//   total received   - from the payment transactions, according to ACCOUNTING_POLICY
//   balance          - earnings - total received
//
//   BIGARI    earnings = sum of attendance earnings (units x the rate in force that day)
//   MAAPVALI  earnings = sum of maap entry earnings (maaps x the worker's rate per maap)
//   PATLAVALE earnings = sum of payable-brick earnings in the production ledger
//
// Every transaction is counted exactly once. Bayana is a payment type like any other: it is part of
// "total received" and is never subtracted a second time as a separate "advance".
// Payments never feed back into attendance, maap entries or production.
import { LABOUR_TYPES } from "./labourTypes";
import { PAYMENT_TYPES } from "./paymentTypes";
import { summarizeProduction } from "./productionCalculations";

/**
 * [OPEN - confirm with the client before the balance formula is frozen]
 *  - Is Bayana always money received / advance against earnings?
 *  - Should "Other" payments reduce earned salary, or be shown separately?
 * Until they answer, both count as received. This object is the ONLY place to change that.
 */
export const ACCOUNTING_POLICY = Object.freeze({
  bayanaCountsAsReceived: true,
  otherCountsAsReceived: true,
});

/** Does this payment type reduce the balance under the policy? */
export const countsAsReceived = (type, policy = ACCOUNTING_POLICY) => {
  if (type === PAYMENT_TYPES.BOOKING_ADVANCE) return policy.bayanaCountsAsReceived;
  if (type === PAYMENT_TYPES.OTHER) return policy.otherCountsAsReceived;
  return true; // SALARY_PAYMENT
};

const sum = (items, pick) => items.reduce((total, item) => total + pick(item), 0);

/**
 * Totals of the payment transactions (deleted ones are ignored).
 * totalReceived counts each counted transaction once; notCounted is money paid that the policy keeps out of the balance.
 */
export const summarizeTransactions = (payments = [], policy = ACCOUNTING_POLICY) => {
  const live = payments.filter((p) => !p.isDeleted);
  const sumOf = (type) => sum(live.filter((p) => p.type === type), (p) => p.amount);

  const bookingAdvance = sumOf(PAYMENT_TYPES.BOOKING_ADVANCE);
  const salaryPayments = sumOf(PAYMENT_TYPES.SALARY_PAYMENT);
  const otherPayments = sumOf(PAYMENT_TYPES.OTHER);

  const totalReceived = sum(
    live.filter((p) => countsAsReceived(p.type, policy)),
    (p) => p.amount
  );

  return {
    bookingAdvance,
    salaryPayments,
    otherPayments,
    totalReceived,
    notCounted: bookingAdvance + salaryPayments + otherPayments - totalReceived,
  };
};

export const computeBalance = (earned, totalReceived) => earned - totalReceived;

/** Bigari: `attendance` records must already carry `units`, `rate` and `earned` (see enrichAttendance). */
export const calculateBigariEarnings = (attendance = []) => ({
  earned: sum(attendance, (r) => r.earned),
  workingUnits: sum(attendance, (r) => r.units),
});

/** Maapvali: maaps x that worker's rate (each entry carries the rate it was recorded at). */
export const calculateMaapvaliEarnings = (entries = []) => ({
  earned: sum(entries, (e) => e.earnings),
  totalMaaps: sum(entries, (e) => e.numberOfMaaps),
  workDays: entries.length,
});

/** Patlavale: payable bricks x the team's rate. Physical, payable and carry-forward bricks stay separate. */
export const calculatePatlavaleEarnings = (entries = []) => {
  const ledger = [...entries].sort((a, b) => a.date.localeCompare(b.date));
  const production = summarizeProduction(ledger);
  return {
    earned: production.totalEarnings,
    totalPhysicalBricks: production.totalPhysicalBricks,
    totalPayableBricks: production.totalPayableBricks,
    carryForwardBricks: production.carryForwardBricks,
    productionDays: ledger.length,
  };
};

/**
 * The account of one labour record.
 * data: { attendance (enriched, Bigari only), maapEntries (Maapvali only), productionEntries (Patlavale only), payments }
 * Records that do not belong to the type are ignored, so a stray record can never create earnings.
 */
export const buildAccount = ({ labourType, attendance, maapEntries, productionEntries, payments, policy = ACCOUNTING_POLICY }) => {
  let earnings;
  if (labourType === LABOUR_TYPES.MAAPVALI) earnings = calculateMaapvaliEarnings(maapEntries);
  else if (labourType === LABOUR_TYPES.PATLAVALE) earnings = calculatePatlavaleEarnings(productionEntries);
  else earnings = calculateBigariEarnings(attendance);

  const transactions = summarizeTransactions(payments, policy);
  return { ...earnings, ...transactions, balance: computeBalance(earnings.earned, transactions.totalReceived) };
};
