import { LABOUR_STATUS, LABOUR_TYPES } from "../constants/labour.js";
import { DEFAULT_CORRECTION_REASON } from "../constants/maapvali.js";
import Labour from "../models/Labour.js";
import LabourRateHistory from "../models/LabourRateHistory.js";
import MaapEntry from "../models/MaapEntry.js";
import ApiError from "../utils/ApiError.js";
import { isFutureBusinessDate, todayBusinessDate } from "../utils/dates.js";
import { paiseToRupees } from "../utils/money.js";
import { ratePaiseAt, sortRatesAsc } from "./labourRates.js";
import { maapvaliEarningsPaise, summarizeMaapEntries } from "./maapCalculations.js";

// Maapvali work = a worker's maaps for one business day. Rules for this module:
//  - At most ONE live entry per worker per date (partial unique index). Saving a day again corrects that entry; it never adds a second.
//  - The RATE IS A SNAPSHOT: the rate in force on the work date is copied onto the entry when it is first saved and is never
//    changed by a correction or by a later rate change. earnings = maaps / 4 x that rate, rounded half up once, stored.
//  - A day is validated as a whole (one bad row rejects the request, nothing written). Saving the same numbers again changes
//    nothing, so a retry is safe.
//  - Entries are never hard-deleted. A correction keeps the old values (who, when, why); a delete is a soft delete with a reason.
//  - Payments never read or write these entries. Payments change balances only.

const fieldError = (status, message, field) => new ApiError(status, message, [{ field, message }]);
const isDuplicateKey = (err) => err?.code === 11000;
const live = { isDeleted: false };

// ---------- Output shapes (the frontend's own field names; money in rupees) ----------

export const toEntryDto = (row) => ({
  id: String(row._id),
  labourId: row.labourId,
  date: row.date,
  numberOfMaaps: row.numberOfMaaps,
  ratePerFourMaaps: paiseToRupees(row.ratePaise),
  earnings: paiseToRupees(row.earningsPaise),
  note: row.note ?? "",
  backdatedReason: row.backdatedReason ?? null,
  revision: row.revision ?? 1,
  corrected: (row.revision ?? 1) > 1,
  isDeleted: Boolean(row.isDeleted),
  ...(row.isDeleted ? { deletedReason: row.deletedReason, deletedAt: row.deletedAt, deletedBy: row.deletedBy } : {}),
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

const toDetailDto = (row) => ({
  ...toEntryDto(row),
  history: (row.history ?? []).map(({ at, by, reason, before }) => ({
    at,
    by,
    reason,
    before: { date: before.date, numberOfMaaps: before.numberOfMaaps, note: before.note ?? "", earnings: paiseToRupees(before.earningsPaise) },
  })),
});

export const toSummaryDto = (rows) => {
  const { entries, maaps, earningsPaise, estimatedBricks } = summarizeMaapEntries(rows);
  return { entries, maaps, earnings: paiseToRupees(earningsPaise), estimatedBricks };
};

const byLabourThenDate = (a, b) => a.labourId.localeCompare(b.labourId) || a.date.localeCompare(b.date);
const newestFirst = (a, b) => b.date.localeCompare(a.date) || a.labourId.localeCompare(b.labourId);
const stateFilter = (includeDeleted) => (includeDeleted ? {} : live);

// ---------- Reads ----------

/** One day: every live entry (voided ones only when asked) plus the day's totals over live entries. */
export const getDay = async (date, { includeDeleted = false } = {}) => {
  const rows = (await MaapEntry.find({ date, ...stateFilter(includeDeleted) }).lean()).sort(byLabourThenDate);
  return { date, items: rows.map(toEntryDto), summary: toSummaryDto(rows.filter((r) => !r.isDeleted)) };
};

/** A date range, newest first, paged. `summary` covers every live entry that matches, not only the page. */
export const listRange = async ({ from, to, labourId, includeDeleted = false, page = 1, limit = 100 }) => {
  const filter = { ...stateFilter(includeDeleted) };
  if (from || to) filter.date = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) };
  if (labourId) filter.labourId = labourId;
  const [total, rows, all] = await Promise.all([
    MaapEntry.countDocuments(filter),
    MaapEntry.find(filter).sort({ date: -1, labourId: 1 }).skip((page - 1) * limit).limit(limit).lean(),
    MaapEntry.find({ ...filter, ...live }).lean(),
  ]);
  return { items: rows.map(toEntryDto), page, limit, total, summary: toSummaryDto(all) };
};

const loadEntry = async (id) => {
  const [row] = await MaapEntry.find({ _id: id }).lean();
  if (!row) throw ApiError.notFound("Maap entry not found");
  return row;
};

/** One entry with its correction trail. */
export const getEntry = async (id) => toDetailDto(await loadEntry(id));

/** A worker's history, newest first, with the totals of their live entries. Empty for anyone who is not Maapvali. */
export const getLabourHistory = async (labourId, { from, to, includeDeleted = false } = {}) => {
  const [labour] = await Labour.find({ _id: labourId }).lean();
  if (!labour) throw ApiError.notFound("Labour not found");
  const filter = { labourId, ...stateFilter(includeDeleted) };
  if (from || to) filter.date = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) };
  const rows = labour.labourType === LABOUR_TYPES.MAAPVALI ? (await MaapEntry.find(filter).lean()).sort(newestFirst) : [];
  return { items: rows.map(toEntryDto), summary: toSummaryDto(rows.filter((r) => !r.isDeleted)) };
};

// ---------- Write: save one day ----------

const rowErrors = ({ rows, date, labours, existing, rates }) => {
  const errors = [];
  rows.forEach((row, i) => {
    const add = (message) => errors.push({ field: `rows.${i}.labourId`, message });
    const labour = labours.get(row.labourId);
    if (!labour) return add("Labour not found");
    if (labour.labourType !== LABOUR_TYPES.MAAPVALI) return add("Maap work is only for Maapvali workers");
    if (labour.joiningDate > date) return add(`Joined on ${labour.joiningDate}, after this date`);
    if (labour.status !== LABOUR_STATUS.ACTIVE && !existing.has(row.labourId)) return add("This worker is inactive and has no entry for this date");
    if (!existing.has(row.labourId) && ratePaiseAt(rates.get(row.labourId), date) === null) return add("This worker has no rate set");
    return undefined;
  });
  return errors;
};

/**
 * Save one day. rows: [{ labourId, maaps, note? }], at most one per worker.
 * New worker/date -> a new entry with the rate in force that day. Existing entry -> corrected in place (its own rate kept).
 * Returns the whole day afterwards plus how many entries were created, corrected and left as they were.
 */
export const saveDay = async (date, { rows, reason }, actor, now = new Date()) => {
  const today = todayBusinessDate(now);
  if (isFutureBusinessDate(date, now)) throw fieldError(400, `Maap work cannot be saved for a future date (today is ${today})`, "date");

  const ids = rows.map((r) => r.labourId);
  const [labourRows, existingRows, rateRows] = await Promise.all([
    Labour.find({ _id: { $in: ids } }).lean(),
    MaapEntry.find({ date, labourId: { $in: ids }, ...live }).lean(),
    LabourRateHistory.find({ labourId: { $in: ids } }).lean(),
  ]);
  const labours = new Map(labourRows.map((l) => [String(l._id), l]));
  const existing = new Map(existingRows.map((e) => [e.labourId, e]));
  const rates = new Map();
  for (const r of rateRows) rates.set(r.labourId, [...(rates.get(r.labourId) ?? []), r]);
  for (const [id, list] of rates) rates.set(id, sortRatesAsc(list));

  const errors = rowErrors({ rows, date, labours, existing, rates });
  if (errors.length) throw ApiError.badRequest("Some rows cannot be saved. Nothing was saved.", errors);

  const noteOf = (row) => row.note ?? "";
  const changes = rows.filter((row) => {
    const before = existing.get(row.labourId);
    return !before || before.numberOfMaaps !== row.maaps || (before.note ?? "") !== noteOf(row);
  });
  const backdated = date < today;
  if (backdated && changes.length > 0 && !reason) throw fieldError(400, "A reason is required when changing a day before today", "reason");

  const actorId = actor.id ?? null;
  const counts = { created: 0, updated: 0, unchanged: rows.length - changes.length };
  const conflicts = [];

  await Promise.all(
    rows.map(async (row, i) => {
      const before = existing.get(row.labourId);
      const conflict = () => conflicts.push({ field: `rows.${i}.labourId`, message: "Changed by someone else while saving. Reload and try again." });
      if (before && before.numberOfMaaps === row.maaps && (before.note ?? "") === noteOf(row)) return;

      if (!before) {
        const ratePaise = ratePaiseAt(rates.get(row.labourId), date);
        try {
          const result = await MaapEntry.updateOne(
            { labourId: row.labourId, date, ...live },
            {
              $setOnInsert: {
                labourId: row.labourId,
                date,
                numberOfMaaps: row.maaps,
                ratePaise,
                earningsPaise: maapvaliEarningsPaise(row.maaps, ratePaise),
                note: noteOf(row),
                backdatedReason: backdated ? reason : null,
                revision: 1,
                history: [],
                isDeleted: false,
                deletedAt: null,
                deletedBy: null,
                deletedReason: null,
                createdBy: actorId,
                updatedBy: actorId,
              },
            },
            { upsert: true }
          );
          if (result.upsertedCount === 1) counts.created += 1;
          else conflict(); // someone saved this worker's day between our check and our write
        } catch (err) {
          if (!isDuplicateKey(err)) throw err;
          conflict();
        }
        return;
      }

      // Correction: the entry keeps its OWN rate snapshot. Applies only if nobody changed it since we read it.
      const result = await MaapEntry.updateOne(
        { _id: before._id, revision: before.revision, ...live },
        {
          $set: { numberOfMaaps: row.maaps, note: noteOf(row), earningsPaise: maapvaliEarningsPaise(row.maaps, before.ratePaise), updatedBy: actorId },
          $inc: { revision: 1 },
          $push: {
            history: {
              at: now,
              by: actor.name,
              byId: actorId,
              reason: reason ?? DEFAULT_CORRECTION_REASON,
              before: { date: before.date, numberOfMaaps: before.numberOfMaaps, note: before.note ?? "", earningsPaise: before.earningsPaise },
            },
          },
        }
      );
      if (result.matchedCount === 1) counts.updated += 1;
      else conflict();
    })
  );

  if (conflicts.length) {
    throw ApiError.conflict(`${conflicts.length} row${conflicts.length === 1 ? " was" : "s were"} changed by someone else. The rest were saved; reload and save again.`, conflicts);
  }
  return { ...(await getDay(date)), saved: counts };
};

// ---------- Write: correct or delete one entry ----------

/** Correct date, maaps and/or note. The rate snapshot stays; earnings are recalculated from the new maaps and that rate. */
export const correctEntry = async (id, { date, numberOfMaaps, note, reason }, actor, now = new Date()) => {
  const entry = await loadEntry(id);
  if (entry.isDeleted) throw ApiError.conflict("A deleted entry cannot be corrected");

  const next = { date: date ?? entry.date, numberOfMaaps: numberOfMaaps ?? entry.numberOfMaaps, note: note ?? entry.note ?? "" };
  if (next.date === entry.date && next.numberOfMaaps === entry.numberOfMaaps && next.note === (entry.note ?? "")) return toDetailDto(entry); // nothing to change

  if (next.date !== entry.date) {
    if (isFutureBusinessDate(next.date, now)) throw fieldError(400, `The date cannot be in the future (today is ${todayBusinessDate(now)})`, "date");
    const [labour] = await Labour.find({ _id: entry.labourId }).lean();
    if (labour && labour.joiningDate > next.date) throw fieldError(400, `Joined on ${labour.joiningDate}, after this date`, "date");
    if ((await MaapEntry.find({ labourId: entry.labourId, date: next.date, ...live }).lean()).length) {
      throw fieldError(409, "This worker already has an entry for that date", "date");
    }
  }

  const actorId = actor.id ?? null;
  try {
    const result = await MaapEntry.updateOne(
      { _id: entry._id, revision: entry.revision, ...live },
      {
        $set: { ...next, earningsPaise: maapvaliEarningsPaise(next.numberOfMaaps, entry.ratePaise), updatedBy: actorId },
        $inc: { revision: 1 },
        $push: {
          history: {
            at: now,
            by: actor.name,
            byId: actorId,
            reason,
            before: { date: entry.date, numberOfMaaps: entry.numberOfMaaps, note: entry.note ?? "", earningsPaise: entry.earningsPaise },
          },
        },
      }
    );
    if (result.matchedCount !== 1) throw ApiError.conflict("This entry was changed by someone else. Reload and try again.");
  } catch (err) {
    if (isDuplicateKey(err)) throw fieldError(409, "This worker already has an entry for that date", "date");
    throw err;
  }
  return getEntry(id);
};

/** Soft delete: the entry stays (with who, when and why) and is left out of every total. A new entry can then be made for that day. */
export const deleteEntry = async (id, { reason }, actor, now = new Date()) => {
  const entry = await loadEntry(id);
  if (entry.isDeleted) throw ApiError.conflict("This entry is already deleted");
  const result = await MaapEntry.updateOne(
    { _id: entry._id, ...live },
    { $set: { isDeleted: true, deletedAt: now, deletedBy: actor.name, deletedReason: reason, updatedBy: actor.id ?? null } }
  );
  if (result.matchedCount !== 1) throw ApiError.conflict("This entry was changed by someone else. Reload and try again.");
  return getEntry(id);
};
