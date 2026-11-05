// Pure payment and balance calculations (no database), so every screen gets the same answer.
//
//   totalReceived = sum of live (not voided) payments the ACCOUNTING_POLICY counts as received
//   balance       = earned - totalReceived          (negative = paid more than earned)
//
// Every payment is counted exactly once. Bayana is an ordinary payment type: it is part of totalReceived and is never
// subtracted a second time as a separate "advance". All amounts are integer paise; nothing here rounds.
// Earnings come from work records and are an INPUT here. Nothing in this file can change them.
import { ACCOUNTING_POLICY, PAYMENT_TYPES, countsAsReceived } from "../constants/payments.js";
import { sumPaise } from "../utils/money.js";

/** Totals of payment rows ({ type, amountPaise, isDeleted }). Voided rows are ignored. */
export const summarizePayments = (rows = [], policy = ACCOUNTING_POLICY) => {
  const live = rows.filter((p) => !p.isDeleted);
  const sumOf = (type) => sumPaise(live.filter((p) => p.type === type).map((p) => p.amountPaise));
  const bayanaPaise = sumOf(PAYMENT_TYPES.BOOKING_ADVANCE);
  const salaryPaise = sumOf(PAYMENT_TYPES.SALARY_PAYMENT);
  const otherPaise = sumOf(PAYMENT_TYPES.OTHER);
  const totalReceivedPaise = sumPaise(live.filter((p) => countsAsReceived(p.type, policy)).map((p) => p.amountPaise));
  return { payments: live.length, bayanaPaise, salaryPaise, otherPaise, totalReceivedPaise, notCountedPaise: bayanaPaise + salaryPaise + otherPaise - totalReceivedPaise };
};

export const balancePaise = (earnedPaise, totalReceivedPaise) => earnedPaise - totalReceivedPaise;
