// Rate history: one "Initial rate" entry per labour + two demo Bigari rate changes.
// Shape: { id, labourId, rateType, rate, effectiveFrom, reason, changedBy, createdAt }
// rateType: DAILY_RATE (Bigari) | RATE_PER_FOUR_MAAPS (Maapvali) | RATE_PER_1000_PAYABLE_BRICKS (Patlavale)
// Whether Maapvali / Patlavale rates may change is still to be confirmed; the shape allows it.
import { toISODate } from "../utils/formatDate";
import { LABOUR_TYPE_META } from "../utils/labourTypes";
import { labourSeeds, maapvaliRecords, patlavaleRecords } from "./labours";

const daysAgo = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return toISODate(d);
};

// Labour whose rate was different when they joined (their current rate is in mock/labours.js)
const startingRate = { "L-001": 600, "L-004": 700 };

const changes = [
  { labourId: "L-001", effectiveFrom: daysAgo(40), reason: "Rate revised after review" },
  { labourId: "L-004", effectiveFrom: daysAgo(14), reason: "Yearly increase" },
];

const bigariRateHistory = [
  ...labourSeeds.map((seed) => ({
    id: `rate-${seed.id}-0`,
    labourId: seed.id,
    rate: startingRate[seed.id] ?? seed.dailyRate,
    effectiveFrom: seed.joiningDate,
    rateType: "DAILY_RATE",
    reason: "Initial rate",
    changedBy: "Ramesh Patel",
    createdAt: seed.joiningDate,
  })),
  ...changes.map((change) => ({
    id: `rate-${change.labourId}-1`,
    labourId: change.labourId,
    rate: labourSeeds.find((s) => s.id === change.labourId).dailyRate,
    rateType: "DAILY_RATE",
    effectiveFrom: change.effectiveFrom,
    reason: change.reason,
    changedBy: "Ramesh Patel",
    createdAt: change.effectiveFrom,
  })),
];

// Initial rate for the other two types.
const otherTypeRateHistory = [...maapvaliRecords, ...patlavaleRecords].map((record) => {
  const meta = LABOUR_TYPE_META[record.labourType];
  return {
    id: `rate-${record.id}-0`,
    labourId: record.id,
    rateType: meta.rateType,
    rate: record[meta.rateField],
    effectiveFrom: record.joiningDate,
    reason: "Initial rate",
    changedBy: "Ramesh Patel",
    createdAt: record.joiningDate,
  };
});

export const initialRateHistory = [...bigariRateHistory, ...otherTypeRateHistory];
