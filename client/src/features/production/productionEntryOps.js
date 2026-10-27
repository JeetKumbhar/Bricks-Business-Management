// Pure functions that create / correct / delete Patlavale production entries. Production entries never touch the payment ledger.
//
// An entry stores what the owner typed that day (`newMaaps`) and the rate snapshot (`ratePer1000PayableBricks`, i.e. the
// rate per 4 maaps). Physical bricks (maaps x 275), payable bricks (maaps x 250) and earnings (maaps / 4 x rate) are derived
// from those two numbers alone. Entries are independent: there is no carry-forward.
import { LABOUR_TYPES } from "../../utils/labourTypes";
import { deriveProductionEntry, parseDailyMaaps } from "../../utils/dailyWorkCalculations";

const assertMaaps = (maaps) => {
  const parsed = parseDailyMaaps(maaps);
  if (parsed.status !== "ok") throw new RangeError(parsed.message ?? "Enter the number of maaps");
};

/** The team's rate is copied from its profile at the moment of entry (a snapshot). Derived fields come from deriveProductionEntry. */
export const createProductionEntry = ({ team, date, newMaaps, note = "", seasonId, backdatedReason, now = new Date() }) => {
  if (!team || team.labourType !== LABOUR_TYPES.PATLAVALE) {
    throw new Error("Production can only be recorded for a Patlavale family / team");
  }
  assertMaaps(newMaaps);

  return deriveProductionEntry({
    id: `prod-${team.id}-${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
    teamId: team.id,
    seasonId,
    date,
    newMaaps,
    ratePer1000PayableBricks: team.ratePer1000PayableBricks,
    note,
    ...(backdatedReason ? { backdatedReason } : {}),
    isDeleted: false,
    createdAt: now.toISOString(),
  });
};

/** Correction: date, maaps and note can change; the entry keeps its own rate snapshot. A reason is required. */
export const applyProductionCorrection = (entry, { date, newMaaps, note }, reason, now = new Date()) => {
  assertMaaps(newMaaps);
  return deriveProductionEntry({ ...entry, date, newMaaps, note, editedReason: reason, updatedAt: now.toISOString() });
};

/** Soft delete: the record stays (traceable), the ledger ignores it. A reason is required. */
export const applyProductionDelete = (entry, reason, now = new Date()) => ({
  ...entry,
  isDeleted: true,
  deletedReason: reason,
  deletedAt: now.toISOString(),
});

/**
 * Save one whole day. rows: [{ team, maaps (whole number), note }].
 * One record per team and date: an existing record is corrected, otherwise a new one is created.
 * Unchanged rows are left alone. Returns { entries, changedIds }.
 */
export const upsertProductionDay = ({ allEntries, date, rows, reason, seasonId, now = new Date() }) => {
  let next = allEntries;
  const changedIds = [];

  rows.forEach(({ team, maaps, note = "" }) => {
    const existing = next.find((e) => !e.isDeleted && e.teamId === team.id && e.date === date);
    if (existing) {
      if (existing.newMaaps === maaps && (existing.note ?? "") === note) return;
      const corrected = applyProductionCorrection(existing, { date, newMaaps: maaps, note }, reason ?? "Daily entry updated", now);
      next = next.map((e) => (e.id === existing.id ? corrected : e));
      changedIds.push(existing.id);
    } else {
      const created = createProductionEntry({ team, date, newMaaps: maaps, note, seasonId, backdatedReason: reason, now });
      next = [...next, created];
      changedIds.push(created.id);
    }
  });

  return { entries: next, changedIds };
};
