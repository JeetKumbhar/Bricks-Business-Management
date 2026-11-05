import { LABOUR_TYPES } from "../constants/labour.js";
import Attendance from "../models/Attendance.js";
import Labour from "../models/Labour.js";
import LabourRateHistory from "../models/LabourRateHistory.js";
import MaapEntry from "../models/MaapEntry.js";
import Payment from "../models/Payment.js";
import ProductionEntry from "../models/ProductionEntry.js";
import ApiError from "../utils/ApiError.js";
import { ATTENDANCE_UNITS } from "../constants/attendance.js";
import { physicalBricksForMaaps, paiseToRupees, sumPaise } from "../utils/money.js";
import { earnedPaiseFor } from "./attendance.service.js";
import { ratePaiseAt, sortRatesAsc } from "./labourRates.js";
import { balancePaise, summarizePayments } from "./paymentCalculations.js";

// Balance = what the labour has earned from work minus what has been paid (all-time; payments are not tied to a season).
// This module only READS work records and payments. It never writes either, so asking for a balance cannot change work,
// production or payments. Earnings use the figures already stored on each record (a rate snapshot per entry), or, for
// Bigari attendance, the rate in force on each day: exactly what the work screens show.

const live = { isDeleted: false };
const groupBy = (rows, key) => {
  const map = new Map();
  for (const r of rows) map.set(r[key], [...(map.get(r[key]) ?? []), r]);
  return map;
};

const bigariWork = (rows, rates) => {
  const ordered = sortRatesAsc(rates ?? []);
  const earned = sumPaise(rows.map((r) => earnedPaiseFor(r.status, ratePaiseAt(ordered, r.date)) ?? 0));
  return { earnedPaise: earned, work: { workingUnits: rows.reduce((t, r) => t + ATTENDANCE_UNITS[r.status], 0), workDays: rows.length } };
};
const maapWork = (rows) => ({ earnedPaise: sumPaise(rows.map((r) => r.earningsPaise)), work: { maaps: rows.reduce((t, r) => t + r.numberOfMaaps, 0), workDays: rows.length } });
const teamWork = (rows) => {
  const maaps = rows.reduce((t, r) => t + r.numberOfMaaps, 0);
  return { earnedPaise: sumPaise(rows.map((r) => r.earningsPaise)), work: { maaps, payableBricks: rows.reduce((t, r) => t + r.payableBricks, 0), physicalBricks: physicalBricksForMaaps(maaps), productionDays: rows.length } };
};

/** One balance line per labour: earned, each kind of payment, total received, balance. Pure reads. */
const balancesFor = async (labours) => {
  const ids = labours.map((l) => String(l._id));
  const [attendance, rateRows, maap, production, payments] = await Promise.all([
    Attendance.find({ labourId: { $in: ids } }).lean(),
    LabourRateHistory.find({ labourId: { $in: ids } }).lean(),
    MaapEntry.find({ labourId: { $in: ids }, ...live }).lean(),
    ProductionEntry.find({ teamId: { $in: ids }, ...live }).lean(),
    Payment.find({ recipientId: { $in: ids }, ...live }).lean(),
  ]);
  const att = groupBy(attendance, "labourId");
  const rates = groupBy(rateRows, "labourId");
  const maaps = groupBy(maap, "labourId");
  const prod = groupBy(production, "teamId");
  const paid = groupBy(payments, "recipientId");

  return labours.map((l) => {
    const id = String(l._id);
    const { earnedPaise, work } =
      l.labourType === LABOUR_TYPES.MAAPVALI ? maapWork(maaps.get(id) ?? []) : l.labourType === LABOUR_TYPES.PATLAVALE ? teamWork(prod.get(id) ?? []) : bigariWork(att.get(id) ?? [], rates.get(id));
    const p = summarizePayments(paid.get(id) ?? []);
    const balance = balancePaise(earnedPaise, p.totalReceivedPaise);
    return {
      labourId: id,
      name: l.name,
      labourType: l.labourType,
      status: l.status,
      earned: paiseToRupees(earnedPaise),
      bayana: paiseToRupees(p.bayanaPaise),
      salaryPayments: paiseToRupees(p.salaryPaise),
      otherPayments: paiseToRupees(p.otherPaise),
      totalReceived: paiseToRupees(p.totalReceivedPaise),
      notCounted: paiseToRupees(p.notCountedPaise),
      balance: paiseToRupees(balance),
      overpaid: balance < 0,
      work,
      _paise: { earnedPaise, totalReceivedPaise: p.totalReceivedPaise, balance },
    };
  });
};

const publicLine = ({ _paise, ...line }) => line;

export const getBalance = async (labourId) => {
  const [labour] = await Labour.find({ _id: labourId }).lean();
  if (!labour) throw ApiError.notFound("Labour not found");
  return publicLine((await balancesFor([labour]))[0]);
};

/** Everyone (or one type / status), by id, with grand totals summed from exact paise. */
export const listBalances = async ({ labourType, status } = {}) => {
  const filter = { ...(labourType ? { labourType } : {}), ...(status ? { status } : {}) };
  const labours = (await Labour.find(filter).lean()).sort((a, b) => String(a._id).localeCompare(String(b._id)));
  const lines = await balancesFor(labours);
  const totals = {
    labours: lines.length,
    earned: paiseToRupees(sumPaise(lines.map((l) => l._paise.earnedPaise))),
    totalReceived: paiseToRupees(sumPaise(lines.map((l) => l._paise.totalReceivedPaise))),
    balance: paiseToRupees(sumPaise(lines.map((l) => l._paise.balance))),
  };
  return { items: lines.map(publicLine), totals };
};

