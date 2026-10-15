// Pure functions that build every Dashboard number from the underlying records.
// Nothing here is typed in by hand, so Dashboard values always match the Attendance, Maapvali, Patlavale
// and Payments pages. Prototype calculations: final financial calculations belong to the backend.
import { countsAsReceived } from "../../utils/accountCalculations";
import { addDaysISO } from "../../utils/formatDate";
import { LABOUR_STATUS } from "../../utils/labourStatus";
import { LABOUR_TYPES } from "../../utils/labourTypes";
import { PAYMENT_TYPES, PAYMENT_TYPE_META } from "../../utils/paymentTypes";
import { getEligibleLabours, summarize } from "../attendance/attendanceSelectors";
import { summarizeSeason } from "../production/productionSelectors";

const sum = (items, pick) => items.reduce((total, item) => total + pick(item), 0);
const isActive = (l) => l.status === LABOUR_STATUS.ACTIVE;

/** Recent things that happened, newest first. Date-only records are placed at midday of their date. */
export const buildRecentActivities = ({ labours, payments, maapEntries, productionEntries, attendanceDays, limit = 6 }) => {
  const byId = Object.fromEntries(labours.map((l) => [l.id, l]));
  const at = (record) => record.createdAt ?? `${record.date}T12:00:00.000Z`;
  const items = [];

  payments.slice(0, 4).forEach((p) =>
    items.push({
      id: `pay-${p.id}`,
      type: "payment",
      title: p.type === PAYMENT_TYPES.BOOKING_ADVANCE ? "Bayana given" : "Payment recorded",
      detail: `${byId[p.labourId]?.name ?? p.labourId} - ₹${p.amount.toLocaleString("en-IN")} (${PAYMENT_TYPE_META[p.type].label})`,
      time: at(p),
    })
  );

  maapEntries.slice(0, 3).forEach((e) =>
    items.push({
      id: `maap-${e.id}`,
      type: "maap",
      title: "Maap work recorded",
      detail: `${byId[e.labourId]?.name ?? e.labourId} - ${e.numberOfMaaps} maaps (₹${e.earnings.toLocaleString("en-IN")})`,
      time: at(e),
    })
  );

  // productionEntries are oldest first
  [...productionEntries]
    .reverse()
    .slice(0, 3)
    .forEach((e) =>
      items.push({
        id: `prod-${e.id}`,
        type: "production",
        title: "Production recorded",
        detail: `${byId[e.teamId]?.name ?? e.teamId} - ${e.newPhysicalBricks.toLocaleString("en-IN")} physical, ${e.newPayableBricks.toLocaleString("en-IN")} payable`,
        time: at(e),
      })
    );

  // most recent day with Bigari attendance marked
  const markedDay = attendanceDays.find((d) => d.marked > 0);
  if (markedDay) {
    items.push({
      id: `att-${markedDay.date}`,
      type: "attendance",
      title: "Attendance marked (Bigari)",
      detail: `${markedDay.present} present, ${markedDay.halfDay} half day, ${markedDay.absent} absent`,
      time: `${markedDay.date}T12:00:00.000Z`,
    });
  }

  return items.sort((a, b) => b.time.localeCompare(a.time)).slice(0, limit);
};

/**
 * labours: every labour record with its calculated account (earned, totalReceived, balance)
 * getAttendanceByDate(date) -> { labourId: status };  getAttendance(labourId) -> enriched attendance (Bigari)
 * maapEntries / payments: not deleted, newest first.   productionEntries: not deleted, oldest first.
 */
export const buildDashboardData = ({
  labours,
  getAttendanceByDate,
  getAttendance,
  maapEntries,
  productionEntries,
  payments,
  today,
}) => {
  const days = Array.from({ length: 7 }, (_, i) => addDaysISO(today, i - 6)); // oldest first, ends today
  const start = days[0];
  const inWeek = (record) => record.date >= start && record.date <= today;

  const bigari = labours.filter((l) => l.labourType === LABOUR_TYPES.BIGARI);
  const maapvali = labours.filter((l) => l.labourType === LABOUR_TYPES.MAAPVALI);
  const patlavale = labours.filter((l) => l.labourType === LABOUR_TYPES.PATLAVALE);

  // ---- Bigari attendance only (same roster rule as the Attendance page) ----
  const dayCounts = (date) => {
    const saved = getAttendanceByDate(date);
    const roster = getEligibleLabours(labours, date, saved);
    const counts = summarize(roster, (id) => saved[id] ?? null);
    return { date, ...counts, roster: roster.length, marked: roster.length - counts.unmarked };
  };
  const attendanceToday = dayCounts(today);
  const attendanceDays = [...days].reverse().map(dayCounts); // newest first
  // a day with nothing marked is left blank in the chart instead of showing misleading zeros
  const weeklyAttendance = days.map((date) => {
    const c = attendanceDays.find((d) => d.date === date);
    return {
      date,
      present: c.marked ? c.present : null,
      halfDay: c.marked ? c.halfDay : null,
      absent: c.marked ? c.absent : null,
    };
  });

  // ---- Maapvali ----
  const maapToday = maapEntries.filter((e) => e.date === today);
  const maapWeek = maapEntries.filter(inWeek);

  // ---- Patlavale: physical, payable and carry-forward stay separate; payments never touch them ----
  const season = summarizeSeason(productionEntries);

  // ---- Money ----
  const byType = [LABOUR_TYPES.BIGARI, LABOUR_TYPES.MAAPVALI, LABOUR_TYPES.PATLAVALE].map((type) => {
    const accounts = labours.filter((l) => l.labourType === type);
    return {
      type,
      accounts: accounts.length,
      earned: sum(accounts, (l) => l.earned),
      received: sum(accounts, (l) => l.totalReceived),
      outstanding: sum(accounts, (l) => Math.max(l.balance, 0)),
      overpaid: sum(accounts, (l) => Math.max(-l.balance, 0)),
      overpaidCount: accounts.filter((l) => l.balance < 0).length,
    };
  });
  const outstanding = sum(byType, (t) => t.outstanding);
  const overpaid = sum(byType, (t) => t.overpaid);
  const overpaidCount = sum(byType, (t) => t.overpaidCount);

  const weekPayments = payments.filter(inWeek);
  const weeklyPayments = days.map((date) => {
    const day = payments.filter((p) => p.date === date);
    const of = (type) => sum(day.filter((p) => p.type === type), (p) => p.amount);
    return {
      date,
      bookingAdvance: of(PAYMENT_TYPES.BOOKING_ADVANCE),
      salaryPayment: of(PAYMENT_TYPES.SALARY_PAYMENT),
      other: of(PAYMENT_TYPES.OTHER),
    };
  });

  const weeklyEarnings = {
    bigari: sum(bigari, (l) => sum(getAttendance(l.id).filter(inWeek), (r) => r.earned)),
    maapvali: sum(maapWeek, (e) => e.earnings),
    patlavale: sum(productionEntries.filter(inWeek), (e) => e.newEarnings),
    paid: sum(weekPayments.filter((p) => countsAsReceived(p.type)), (p) => p.amount),
  };
  weeklyEarnings.total = weeklyEarnings.bigari + weeklyEarnings.maapvali + weeklyEarnings.patlavale;

  const byId = Object.fromEntries(labours.map((l) => [l.id, l]));
  const recentPayments = payments.slice(0, 6).map((p) => ({
    ...p,
    labourName: byId[p.labourId]?.name ?? p.labourId,
    labourType: byId[p.labourId]?.labourType,
  }));

  return {
    today,
    workers: {
      bigariActive: bigari.filter(isActive).length,
      maapvaliActive: maapvali.filter(isActive).length,
      patlavaleActive: patlavale.filter(isActive).length,
    },
    attendanceToday,
    weeklyAttendance,
    maap: {
      todayMaaps: sum(maapToday, (e) => e.numberOfMaaps),
      todayEarnings: sum(maapToday, (e) => e.earnings),
      weekMaaps: sum(maapWeek, (e) => e.numberOfMaaps),
    },
    production: { season, activeTeams: patlavale.filter(isActive).length, teams: patlavale.length },
    money: { outstanding, overpaid, overpaidCount, paidLast7: sum(weekPayments, (p) => p.amount), byType },
    weeklyPayments,
    weeklyEarnings,
    recentPayments,
    recentActivities: buildRecentActivities({ labours, payments, maapEntries, productionEntries, attendanceDays }),
  };
};
