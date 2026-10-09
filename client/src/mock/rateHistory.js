// Rate history: one "Initial rate" entry per labour + two demo rate changes.
// Shape: { id, labourId, rate, effectiveFrom, reason, changedBy, createdAt }
import { toISODate } from "../utils/formatDate";
import { labourSeeds } from "./labours";

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

export const initialRateHistory = [
  ...labourSeeds.map((seed) => ({
    id: `rate-${seed.id}-0`,
    labourId: seed.id,
    rate: startingRate[seed.id] ?? seed.dailyRate,
    effectiveFrom: seed.joiningDate,
    reason: "Initial rate",
    changedBy: "Ramesh Patel",
    createdAt: seed.joiningDate,
  })),
  ...changes.map((change) => ({
    id: `rate-${change.labourId}-1`,
    labourId: change.labourId,
    rate: labourSeeds.find((s) => s.id === change.labourId).dailyRate,
    effectiveFrom: change.effectiveFrom,
    reason: change.reason,
    changedBy: "Ramesh Patel",
    createdAt: change.effectiveFrom,
  })),
];
