// PROTOTYPE calculations (frontend only). Final financial calculations belong to the backend.
// For any date range: what each labour record earned and received IN the range, next to the season-to-date
// balance. Earnings come from each type's own records, received money from payments (policy in utils/accountCalculations).
// The season-to-date numbers never depend on the range and are never reset by a payment.
import { ACCOUNTING_POLICY, countsAsReceived } from "../../utils/accountCalculations";
import { LABOUR_STATUS } from "../../utils/labourStatus";
import { LABOUR_TYPES } from "../../utils/labourTypes";
import { PAYMENT_TYPES } from "../../utils/paymentTypes";
import { groupBy } from "../labours/labourStats";

const sum = (items, pick) => items.reduce((total, item) => total + pick(item), 0);

/**
 * labours: every record with its calculated account (earned, totalReceived, balance).
 * getAttendance(id): enriched attendance of a Bigari. maapEntries / payments: not deleted.
 * productionEntries: not deleted, oldest first.
 */
export const buildPeriodAccounts = ({
  labours,
  getAttendance,
  maapEntries,
  productionEntries,
  payments,
  start,
  end,
  policy = ACCOUNTING_POLICY,
}) => {
  const inRange = (r) => r.date >= start && r.date <= end;
  const maapBy = groupBy(maapEntries.filter(inRange), "labourId");
  const productionAllBy = groupBy(productionEntries, "teamId"); // for the carry-forward at the end of the range
  const paymentsBy = groupBy(payments.filter(inRange), "labourId");

  const rows = labours.map((l) => {
    const pays = paymentsBy[l.id] ?? [];
    const of = (type) => sum(pays.filter((p) => p.type === type), (p) => p.amount);

    let work;
    let earned;
    if (l.labourType === LABOUR_TYPES.MAAPVALI) {
      const entries = maapBy[l.id] ?? [];
      earned = sum(entries, (e) => e.earnings);
      work = { maaps: sum(entries, (e) => e.numberOfMaaps), workDays: entries.length };
    } else if (l.labourType === LABOUR_TYPES.PATLAVALE) {
      const all = productionAllBy[l.id] ?? [];
      const entries = all.filter(inRange);
      const lastUpToEnd = [...all].filter((e) => e.date <= end).pop();
      earned = sum(entries, (e) => e.newEarnings);
      work = {
        physicalBricks: sum(entries, (e) => e.newPhysicalBricks),
        payableBricks: sum(entries, (e) => e.newPayableBricks),
        carryForwardBricks: lastUpToEnd?.carryForwardBricks ?? 0, // carry-forward as it stood at the end of the range
        entries: entries.length,
      };
    } else {
      const attendance = getAttendance(l.id).filter(inRange);
      earned = sum(attendance, (r) => r.earned);
      work = {
        presentDays: attendance.filter((r) => r.status === "PRESENT").length,
        halfDays: attendance.filter((r) => r.status === "HALF_DAY").length,
        absentDays: attendance.filter((r) => r.status === "ABSENT").length,
        workingUnits: sum(attendance, (r) => r.units),
      };
    }

    return {
      id: l.id,
      name: l.name,
      village: l.village,
      labourType: l.labourType,
      status: l.status,
      period: {
        earned,
        received: sum(pays.filter((p) => countsAsReceived(p.type, policy)), (p) => p.amount),
        bayana: of(PAYMENT_TYPES.BOOKING_ADVANCE),
        salary: of(PAYMENT_TYPES.SALARY_PAYMENT),
        other: of(PAYMENT_TYPES.OTHER),
        paid: sum(pays, (p) => p.amount),
        work,
      },
      // season to date: from the account calculation layer, independent of the chosen range
      season: { earned: l.earned, received: l.totalReceived, balance: l.balance },
    };
  });

  // Keep active records, anyone with activity in the range, and anyone who still has a balance (an inactive worker
  // who is still owed money must not disappear): this keeps the season-to-date outstanding total the same for every range.
  return rows.filter(
    (r) => r.status === LABOUR_STATUS.ACTIVE || r.period.earned > 0 || r.period.paid > 0 || r.season.balance !== 0
  );
};

/** Totals per labour type, and overall. */
export const summarizePeriod = (rows) => {
  const byType = [LABOUR_TYPES.BIGARI, LABOUR_TYPES.MAAPVALI, LABOUR_TYPES.PATLAVALE].map((type) => {
    const list = rows.filter((r) => r.labourType === type);
    return {
      type,
      accounts: list.length,
      earned: sum(list, (r) => r.period.earned),
      received: sum(list, (r) => r.period.received),
      paid: sum(list, (r) => r.period.paid),
      seasonEarned: sum(list, (r) => r.season.earned),
      seasonReceived: sum(list, (r) => r.season.received),
      outstanding: sum(list, (r) => Math.max(r.season.balance, 0)),
      overpaid: sum(list, (r) => Math.max(-r.season.balance, 0)),
      overpaidCount: list.filter((r) => r.season.balance < 0).length,
    };
  });

  const total = (key) => sum(byType, (t) => t[key]);
  return {
    byType,
    total: {
      earned: total("earned"),
      received: total("received"),
      paid: total("paid"),
      outstanding: total("outstanding"),
      overpaid: total("overpaid"),
      overpaidCount: total("overpaidCount"),
    },
  };
};
