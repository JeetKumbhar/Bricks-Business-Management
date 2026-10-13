// Pure functions that create / correct / delete a Maapvali work entry. No side effects, so they are easy to test
// and can move to the backend later. Work entries never touch the payment ledger.
import { LABOUR_TYPES } from "../../../utils/labourTypes";
import { calculateMaapEarnings, validateMaapCount } from "../../../utils/workCalculations";

const assertMaaps = (maaps) => {
  const problem = validateMaapCount(maaps);
  if (problem) throw new RangeError(problem);
};

/** The rate is copied from the worker's profile at the moment of entry (a snapshot, so later rate changes never rewrite history). */
export const createMaapEntry = ({ worker, date, numberOfMaaps, note = "", seasonId, now = new Date() }) => {
  if (!worker || worker.labourType !== LABOUR_TYPES.MAAPVALI) {
    throw new Error("Maap work can only be recorded for a Maapvali worker");
  }
  assertMaaps(numberOfMaaps);

  return {
    id: `maap-${worker.id}-${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
    labourId: worker.id,
    seasonId,
    date,
    numberOfMaaps,
    ratePerMaap: worker.ratePerMaap,
    earnings: calculateMaapEarnings(numberOfMaaps, worker.ratePerMaap),
    note,
    isDeleted: false,
    createdAt: now.toISOString(),
  };
};

/** Correction: date, maaps and note can change; the rate stays the entry's own snapshot. A reason is required. */
export const applyMaapCorrection = (entry, { date, numberOfMaaps, note }, reason, now = new Date()) => {
  assertMaaps(numberOfMaaps);
  return {
    ...entry,
    date,
    numberOfMaaps,
    earnings: calculateMaapEarnings(numberOfMaaps, entry.ratePerMaap),
    note,
    editedReason: reason,
    updatedAt: now.toISOString(),
  };
};

/** Soft delete: the record stays (traceable), totals ignore it. A reason is required. */
export const applyMaapDelete = (entry, reason, now = new Date()) => ({
  ...entry,
  isDeleted: true,
  deletedReason: reason,
  deletedAt: now.toISOString(),
});
