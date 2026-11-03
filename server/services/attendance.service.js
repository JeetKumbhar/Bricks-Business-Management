import { ATTENDANCE_STATUS, ATTENDANCE_UNITS } from "../constants/attendance.js";
import { LABOUR_STATUS, LABOUR_TYPES } from "../constants/labour.js";
import Attendance from "../models/Attendance.js";
import Labour from "../models/Labour.js";
import LabourRateHistory from "../models/LabourRateHistory.js";
import ApiError from "../utils/ApiError.js";
import { isFutureBusinessDate, todayBusinessDate } from "../utils/dates.js";
import { divideRoundHalfUp, paiseToRupees } from "../utils/money.js";
import { ratePaiseAt, sortRatesAsc } from "./labourRates.js";

// Attendance = a Bigari worker's status for one business day. Rules for this module:
//  - ONE record per labour per date. Saving a day again corrects the record; it never adds a second one
//    (enforced by a unique index; a race that slips past the check ends as a 409, never a duplicate).
//  - A day is saved all-or-nothing as far as the rules go: every entry is checked first and one bad entry rejects the
//    whole request with nothing written. Saving the same statuses again changes nothing, so a retry is always safe.
//  - Records are never deleted. A correction keeps the status it replaced (who, when, why) in `history`.
//  - Attendance holds no money. Payments never read or write it. Earnings are derived when read, from the rate history.

const fieldError = (status, message, field) => new ApiError(status, message, [{ field, message }]);
const isDuplicateKey = (err) => err?.code === 11000;

// ---------- Output shapes ----------

export const toAttendanceDto = (row) => ({
  id: String(row._id),
  labourId: row.labourId,
  date: row.date,
  status: row.status,
  revision: row.revision ?? 1,
  corrected: (row.revision ?? 1) > 1,
  updatedAt: row.updatedAt,
});

const toDetailDto = (row) => ({
  ...toAttendanceDto(row),
  createdAt: row.createdAt,
  history: (row.history ?? []).map(({ from, to, at, by, reason }) => ({ from, to, at, by, reason: reason ?? null })),
});

/** Counts for a set of records (the frontend's summary bar, without "unmarked", which depends on the roster). */
export const summarizeAttendance = (rows) => {
  const count = (status) => rows.filter((r) => r.status === status).length;
  const present = count(ATTENDANCE_STATUS.PRESENT);
  const halfDay = count(ATTENDANCE_STATUS.HALF_DAY);
  return { total: rows.length, present, halfDay, absent: count(ATTENDANCE_STATUS.ABSENT), units: present * ATTENDANCE_UNITS.PRESENT + halfDay * ATTENDANCE_UNITS.HALF_DAY };
};

/** Earnings for one day in paise: a full day is the rate, half a day is half of it rounded half up, absent is 0. */
export const earnedPaiseFor = (status, ratePaise) => {
  if (ratePaise === null || ratePaise === undefined) return null;
  if (status === ATTENDANCE_STATUS.PRESENT) return ratePaise;
  if (status === ATTENDANCE_STATUS.HALF_DAY) return divideRoundHalfUp(ratePaise, 2);
  return 0;
};

// ---------- Reads ----------

const byLabourThenDate = (a, b) => a.labourId.localeCompare(b.labourId) || a.date.localeCompare(b.date);

const dayRecords = async (date) => (await Attendance.find({ date }).lean()).sort(byLabourThenDate);

/** One day: every saved record plus the counts. (Who is on the roster is decided by the labour list, as in the frontend.) */
export const getDay = async (date) => {
  const rows = await dayRecords(date);
  return { date, items: rows.map(toAttendanceDto), summary: summarizeAttendance(rows) };
};

/** A date range, newest first, paged. Optionally one labour and/or one status. */
export const listRange = async ({ from, to, labourId, status, page = 1, limit = 100 }) => {
  const filter = {};
  if (from || to) filter.date = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) };
  if (labourId) filter.labourId = labourId;
  if (status) filter.status = status;
  const [total, rows] = await Promise.all([
    Attendance.countDocuments(filter),
    Attendance.find(filter).sort({ date: -1, labourId: 1 }).skip((page - 1) * limit).limit(limit).lean(),
  ]);
  return { items: rows.map(toAttendanceDto), page, limit, total };
};

/** One record with its full correction trail. */
export const getRecord = async (date, labourId) => {
  const [row] = await Attendance.find({ date, labourId }).lean();
  if (!row) throw ApiError.notFound("No attendance record for this labour on this date");
  return toDetailDto(row);
};

/**
 * A worker's profile history, newest first, each day with the rate in force that day and what it earned.
 * Earned = rate x units, rounded half up once per day (the approved rule); the rate comes from the rate history,
 * so a later rate change never alters an earlier day.
 */
export const getLabourHistory = async (labourId, { from, to } = {}) => {
  const [labour] = await Labour.find({ _id: labourId }).lean();
  if (!labour) throw ApiError.notFound("Labour not found");

  const filter = { labourId };
  if (from || to) filter.date = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) };
  const rows = labour.labourType === LABOUR_TYPES.BIGARI ? (await Attendance.find(filter).lean()).sort((a, b) => b.date.localeCompare(a.date)) : [];
  const rates = sortRatesAsc(await LabourRateHistory.find({ labourId }).lean());

  const items = rows.map((row) => {
    const ratePaise = ratePaiseAt(rates, row.date);
    const earned = earnedPaiseFor(row.status, ratePaise);
    return {
      ...toAttendanceDto(row),
      units: ATTENDANCE_UNITS[row.status],
      rate: ratePaise === null ? null : paiseToRupees(ratePaise),
      earned: earned === null ? null : paiseToRupees(earned),
    };
  });
  return { items, totals: summarizeAttendance(rows) };
};

// ---------- Write: save one day ----------

const entryErrors = ({ entries, date, labours, existing }) => {
  const errors = [];
  entries.forEach((entry, i) => {
    const add = (message) => errors.push({ field: `entries.${i}.labourId`, message });
    const labour = labours.get(entry.labourId);
    if (!labour) return add("Labour not found");
    if (labour.labourType !== LABOUR_TYPES.BIGARI) return add("Attendance is only for Bigari workers");
    if (labour.joiningDate > date) return add(`Joined on ${labour.joiningDate}, after this date`);
    if (labour.status !== LABOUR_STATUS.ACTIVE && !existing.has(entry.labourId)) return add("This labour is inactive and has no record for this date");
    return undefined;
  });
  return errors;
};

/**
 * Save (create or correct) one day's attendance. entries: [{ labourId, status }], at most one per labour.
 * Returns the whole day afterwards plus how many records were created, corrected and left as they were.
 */
export const saveDay = async (date, { entries, reason }, actor, now = new Date()) => {
  if (isFutureBusinessDate(date, now)) throw fieldError(400, `Attendance cannot be saved for a future date (today is ${todayBusinessDate(now)})`, "date");

  const ids = entries.map((e) => e.labourId);
  const [labourRows, existingRows] = await Promise.all([Labour.find({ _id: { $in: ids } }).lean(), Attendance.find({ date, labourId: { $in: ids } }).lean()]);
  const labours = new Map(labourRows.map((l) => [String(l._id), l]));
  const existing = new Map(existingRows.map((r) => [r.labourId, r]));

  const errors = entryErrors({ entries, date, labours, existing });
  if (errors.length) throw ApiError.badRequest("Some entries cannot be saved. Nothing was saved.", errors);

  const actorId = actor.id ?? null;
  const counts = { created: 0, updated: 0, unchanged: 0 };
  const conflicts = [];

  await Promise.all(
    entries.map(async ({ labourId, status }, i) => {
      const before = existing.get(labourId);
      const conflict = () => conflicts.push({ field: `entries.${i}.labourId`, message: "Changed by someone else while saving. Reload and try again." });

      if (!before) {
        try {
          const result = await Attendance.updateOne(
            { labourId, date },
            { $setOnInsert: { labourId, date, status, revision: 1, history: [], createdBy: actorId, updatedBy: actorId } },
            { upsert: true }
          );
          if (result.upsertedCount === 1) counts.created += 1;
          else conflict(); // someone created it between our check and our write
        } catch (err) {
          if (!isDuplicateKey(err)) throw err;
          conflict();
        }
        return;
      }

      if (before.status === status) {
        counts.unchanged += 1; // saving the same status again is a no-op: no new revision, no audit noise
        return;
      }
      // Only applies if the record still has the status we read, so two people correcting at once cannot overwrite each other unseen.
      const result = await Attendance.updateOne(
        { labourId, date, status: before.status },
        {
          $set: { status, updatedBy: actorId },
          $inc: { revision: 1 },
          $push: { history: { from: before.status, to: status, at: now, by: actor.name, byId: actorId, reason: reason ?? null } },
        }
      );
      if (result.matchedCount === 1) counts.updated += 1;
      else conflict();
    })
  );

  if (conflicts.length) {
    throw ApiError.conflict(`${conflicts.length} entr${conflicts.length === 1 ? "y was" : "ies were"} changed by someone else. The rest were saved; reload and save again.`, conflicts);
  }
  return { ...(await getDay(date)), saved: counts };
};
