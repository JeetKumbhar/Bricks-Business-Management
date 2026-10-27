// Pure functions that create / correct / delete Maapvali work entries.
// No side effects, so they are easy to test and can move to the backend later. Work entries never touch the payment ledger.
//
// An entry stores what the owner typed that day (`numberOfMaaps`) and the rate snapshot (`ratePerFourMaaps`).
// `earnings` = maaps / 4 x rate is derived from those two numbers alone. Entries are independent: there is no carry-forward,
// so saving or correcting one day never changes another day.
import { LABOUR_TYPES } from "../../../utils/labourTypes";
import { deriveMaapEntry, parseDailyMaaps } from "../../../utils/dailyWorkCalculations";

const assertMaaps = (maaps) => {
  const parsed = parseDailyMaaps(maaps);
  if (parsed.status !== "ok") throw new RangeError(parsed.message ?? "Enter the number of maaps");
};

/** The rate is copied from the worker's profile at the moment of entry (a snapshot, so later rate changes never rewrite history). */
export const createMaapEntry = ({ worker, date, numberOfMaaps, note = "", seasonId, backdatedReason, now = new Date() }) => {
  if (!worker || worker.labourType !== LABOUR_TYPES.MAAPVALI) {
    throw new Error("Maap work can only be recorded for a Maapvali worker");
  }
  assertMaaps(numberOfMaaps);

  return deriveMaapEntry({
    id: `maap-${worker.id}-${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
    labourId: worker.id,
    seasonId,
    date,
    numberOfMaaps,
    ratePerFourMaaps: worker.ratePerFourMaaps,
    note,
    ...(backdatedReason ? { backdatedReason } : {}),
    isDeleted: false,
    createdAt: now.toISOString(),
  });
};

/** Correction: date, maaps and note can change; the rate stays the entry's own snapshot. A reason is required. */
export const applyMaapCorrection = (entry, { date, numberOfMaaps, note }, reason, now = new Date()) => {
  assertMaaps(numberOfMaaps);
  return deriveMaapEntry({ ...entry, date, numberOfMaaps, note, editedReason: reason, updatedAt: now.toISOString() });
};

/** Soft delete: the record stays (traceable), totals ignore it. A reason is required. */
export const applyMaapDelete = (entry, reason, now = new Date()) => ({
  ...entry,
  isDeleted: true,
  deletedReason: reason,
  deletedAt: now.toISOString(),
});

/**
 * Save one whole day. rows: [{ worker, maaps (whole number, already validated), note }].
 * One record per worker and date: an existing record is corrected, otherwise a new one is created.
 * Rows that do not change anything are left alone.
 * `reason` is stored on each changed record (required by the page when the date is before today).
 * Returns { entries, changedIds }.
 */
export const upsertMaapDay = ({ allEntries, date, rows, reason, seasonId, now = new Date() }) => {
  let next = allEntries;
  const changedKeys = [];

  rows.forEach(({ worker, maaps, note = "" }) => {
    const existing = next.find((e) => !e.isDeleted && e.labourId === worker.id && e.date === date);
    if (existing) {
      if (existing.numberOfMaaps === maaps && (existing.note ?? "") === note) return;
      const corrected = applyMaapCorrection(existing, { date, numberOfMaaps: maaps, note }, reason ?? "Daily entry updated", now);
      next = next.map((e) => (e.id === existing.id ? corrected : e));
      changedKeys.push(existing.id);
    } else {
      const created = createMaapEntry({ worker, date, numberOfMaaps: maaps, note, seasonId, backdatedReason: reason, now });
      next = [...next, created];
      changedKeys.push(created.id);
    }
  });

  return { entries: next, changedIds: changedKeys };
};
