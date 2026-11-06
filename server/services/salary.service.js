import { LABOUR_STATUS, LABOUR_TYPES } from "../constants/labour.js";
import Attendance from "../models/Attendance.js";
import Labour from "../models/Labour.js";
import LabourRateHistory from "../models/LabourRateHistory.js";
import MaapEntry from "../models/MaapEntry.js";
import Payment from "../models/Payment.js";
import ProductionEntry from "../models/ProductionEntry.js";
import ApiError from "../utils/ApiError.js";
import { todayBusinessDate } from "../utils/dates.js";
import { paiseToRupees, sumPaise } from "../utils/money.js";
import { LINE_KINDS, buildLedger, summarizeAccount, withRunningBalance } from "./salaryCalculations.js";

// Salary views. READ ONLY: this module reads attendance, maap entries, production, rate history and payments and never
// writes any of them, so asking for salary can never change work, production or money.
//
// The salary period is simply a date range (the business has no fixed salary week; "this week" and "last 7 days" are
// ranges the screen picks). No range = from the beginning to today. "Season to date" is everything recorded, whatever the
// range, and is never reset by a payment. Every figure comes from ledger lines that point at their source record.

export const ALL_TIME_START = "0000-01-01";
const live = { isDeleted: false };
const groupBy = (rows, key) => {
  const map = new Map();
  for (const r of rows) map.set(r[key], [...(map.get(r[key]) ?? []), r]);
  return map;
};
const rupees = (paise) => paiseToRupees(paise);

const loadSources = async (labours) => {
  const ids = labours.map((l) => String(l._id));
  const [attendance, rates, maap, production, payments] = await Promise.all([
    Attendance.find({ labourId: { $in: ids } }).lean(),
    LabourRateHistory.find({ labourId: { $in: ids } }).lean(),
    MaapEntry.find({ labourId: { $in: ids }, ...live }).lean(),
    ProductionEntry.find({ teamId: { $in: ids }, ...live }).lean(),
    Payment.find({ recipientId: { $in: ids }, ...live }).lean(),
  ]);
  const by = { attendance: groupBy(attendance, "labourId"), rates: groupBy(rates, "labourId"), maap: groupBy(maap, "labourId"), production: groupBy(production, "teamId"), payments: groupBy(payments, "recipientId") };
  return (labour) => {
    const id = String(labour._id);
    return { attendance: by.attendance.get(id) ?? [], rates: by.rates.get(id) ?? [], maap: by.maap.get(id) ?? [], production: by.production.get(id) ?? [], payments: by.payments.get(id) ?? [] };
  };
};

const resolveRange = ({ from, to }, now = new Date()) => ({ from: from ?? ALL_TIME_START, to: to ?? todayBusinessDate(now) });

const workDto = (work) => {
  const { physicalBricks, ...rest } = work;
  return physicalBricks === undefined ? rest : { ...rest, physicalBricks };
};

// ---------- Salary summary (one row per labour, plus totals by type) ----------

const rowFor = (labour, lines, range) => {
  const a = summarizeAccount(labour.labourType, lines, range.from, range.to);
  return {
    id: String(labour._id),
    name: labour.name,
    village: labour.village ?? null,
    labourType: labour.labourType,
    status: labour.status,
    period: {
      earned: rupees(a.period.earnedPaise),
      received: rupees(a.period.receivedPaise),
      bayana: rupees(a.period.bayanaPaise),
      salary: rupees(a.period.salaryPaise),
      other: rupees(a.period.otherPaise),
      paid: rupees(a.period.paidPaise),
      work: workDto(a.period.work),
    },
    opening: rupees(a.openingPaise),
    closing: rupees(a.closingPaise),
    season: { earned: rupees(a.toDate.earnedPaise), received: rupees(a.toDate.receivedPaise), balance: rupees(a.toDate.balancePaise) },
    _paise: a,
  };
};

const publicRow = ({ _paise, ...row }) => row;

// Same rule as the Salary page: keep active records, anyone with activity in the range, and anyone who still has a balance,
// so an inactive worker who is still owed money never disappears and the outstanding total is the same for every range.
const shown = (row) => row.status === LABOUR_STATUS.ACTIVE || row._paise.period.earnedPaise > 0 || row._paise.period.paidPaise > 0 || row._paise.toDate.balancePaise !== 0;

const typeSummary = (type, rows) => {
  const list = rows.filter((r) => r.labourType === type);
  const sum = (pick) => sumPaise(list.map(pick));
  const outstanding = sum((r) => Math.max(r._paise.toDate.balancePaise, 0));
  const overpaid = sum((r) => Math.max(-r._paise.toDate.balancePaise, 0));
  return {
    type,
    accounts: list.length,
    earned: rupees(sum((r) => r._paise.period.earnedPaise)),
    received: rupees(sum((r) => r._paise.period.receivedPaise)),
    paid: rupees(sum((r) => r._paise.period.paidPaise)),
    seasonEarned: rupees(sum((r) => r._paise.toDate.earnedPaise)),
    seasonReceived: rupees(sum((r) => r._paise.toDate.receivedPaise)),
    outstanding: rupees(outstanding),
    overpaid: rupees(overpaid),
    overpaidCount: list.filter((r) => r._paise.toDate.balancePaise < 0).length,
    _paise: { outstanding, overpaid },
  };
};

/** Salary for a date range: one row per labour and totals by type. Totals are sums of the rows' exact paise. */
export const getSalarySummary = async ({ from, to, labourType, status } = {}, now = new Date()) => {
  const range = resolveRange({ from, to }, now);
  const filter = { ...(labourType ? { labourType } : {}), ...(status ? { status } : {}) };
  const labours = (await Labour.find(filter).lean()).sort((a, b) => String(a._id).localeCompare(String(b._id)));
  const sourceFor = await loadSources(labours);
  const rows = labours.map((l) => rowFor(l, buildLedger(l, sourceFor(l)), range)).filter(shown);

  const byType = [LABOUR_TYPES.BIGARI, LABOUR_TYPES.MAAPVALI, LABOUR_TYPES.PATLAVALE].map((t) => typeSummary(t, rows));
  const plain = byType.map(({ _paise, ...t }) => t);
  const add = (key) => rupees(sumPaise(rows.map((r) => ({ earned: r._paise.period.earnedPaise, received: r._paise.period.receivedPaise, paid: r._paise.period.paidPaise })[key])));
  return {
    range,
    items: rows.map(publicRow),
    summary: {
      byType: plain,
      total: {
        earned: add("earned"),
        received: add("received"),
        paid: add("paid"),
        outstanding: rupees(sumPaise(byType.map((t) => t._paise.outstanding))),
        overpaid: rupees(sumPaise(byType.map((t) => t._paise.overpaid))),
        overpaidCount: plain.reduce((t, x) => t + x.overpaidCount, 0),
      },
    },
  };
};

// ---------- Statement (every figure traced to its source record) ----------

const lineDto = (l) => ({
  date: l.date,
  kind: l.kind,
  sourceId: l.sourceId,
  ...(l.kind === LINE_KINDS.ATTENDANCE ? { status: l.status, units: l.units, rate: l.ratePaise === null ? null : rupees(l.ratePaise) } : {}),
  ...(l.kind === LINE_KINDS.MAAP ? { maaps: l.maaps, ratePerFourMaaps: rupees(l.ratePaise) } : {}),
  ...(l.kind === LINE_KINDS.PRODUCTION ? { maaps: l.maaps, payableBricks: l.payableBricks, ratePer1000PayableBricks: rupees(l.ratePaise) } : {}),
  ...(l.kind === LINE_KINDS.PAYMENT ? { paymentType: l.paymentType, method: l.method, amount: rupees(l.amountPaise), countedAsReceived: l.receivedPaise > 0 } : {}),
  earned: rupees(l.earnedPaise),
  received: rupees(l.receivedPaise),
  balance: rupees(l.balancePaise),
});

/**
 * One labour's statement for a range: opening balance, every work and payment line in the range (each with its source id,
 * the rate used and a running balance), the period totals, the closing balance and the season-to-date figures.
 * closing = opening + earned - received, and the last line's running balance equals closing.
 */
export const getStatement = async (labourId, { from, to } = {}, now = new Date()) => {
  const [labour] = await Labour.find({ _id: labourId }).lean();
  if (!labour) throw ApiError.notFound("Labour not found");
  const range = resolveRange({ from, to }, now);
  const lines = buildLedger(labour, (await loadSources([labour]))(labour));
  const row = rowFor(labour, lines, range);
  return {
    labour: { id: row.id, name: row.name, labourType: row.labourType, status: row.status },
    range,
    opening: row.opening,
    period: row.period,
    closing: row.closing,
    season: row.season,
    lines: withRunningBalance(lines, range.from, range.to, row._paise.openingPaise).map(lineDto),
  };
};
