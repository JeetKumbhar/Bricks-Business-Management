import { LABOUR_STATUS, LABOUR_TYPES } from "../constants/labour.js";
import { DEFAULT_CORRECTION_REASON, SEASON_STATUS } from "../constants/production.js";
import Labour from "../models/Labour.js";
import LabourRateHistory from "../models/LabourRateHistory.js";
import ProductionEntry from "../models/ProductionEntry.js";
import ApiError from "../utils/ApiError.js";
import { isFutureBusinessDate, todayBusinessDate } from "../utils/dates.js";
import { paiseToRupees } from "../utils/money.js";
import { ratePaiseAt, sortRatesAsc } from "./labourRates.js";
import { calculateProduction, summarizeProduction } from "./productionCalculations.js";
import { listSeasonRows, loadSeason, seasonForDate, toSeasonDto } from "./season.service.js";

// Patlavale production = a team's maaps for one business day. Rules for this module:
//  - At most ONE live entry per team per date (partial unique index). Saving a day again corrects that entry; never adds a second.
//  - payableBricks = maaps x 250, nothing floored, nothing carried forward. Season totals only ever accumulate.
//  - The RATE IS A SNAPSHOT: the rate in force on the work date is copied onto the entry when first saved and kept on
//    correction. earnings = maaps / 4 x that rate, rounded half up once, stored.
//  - The SEASON is the owner-defined season covering the work date. No season, or a CLOSED one, means no save.
//  - A day is validated as a whole (one bad row rejects the request, nothing written). Same numbers again change nothing.
//  - Entries are never hard-deleted: corrections keep the old values (who, when, why); delete is soft with a reason.
//  - Payments are never read or written here. Production is independent of salary payments.

const fieldError = (status, message, field) => new ApiError(status, message, [{ field, message }]);
const isDuplicateKey = (err) => err?.code === 11000;
const live = { isDeleted: false };

// ---------- Output shapes (the frontend's own field names; money in rupees) ----------

export const toEntryDto = (row) => ({
  id: String(row._id),
  teamId: row.teamId,
  seasonId: row.seasonId,
  date: row.date,
  newMaaps: row.numberOfMaaps,
  newPayableBricks: row.payableBricks,
  newPhysicalBricks: calculateProduction(row.numberOfMaaps, row.ratePaise).physicalBricks,
  ratePer1000PayableBricks: paiseToRupees(row.ratePaise),
  newEarnings: paiseToRupees(row.earningsPaise),
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
    before: { seasonId: before.seasonId, date: before.date, newMaaps: before.numberOfMaaps, newPayableBricks: before.payableBricks, note: before.note ?? "", newEarnings: paiseToRupees(before.earningsPaise) },
  })),
});

export const toSummaryDto = (rows) => {
  const { entries, maaps, payableBricks, physicalBricks, earningsPaise } = summarizeProduction(rows);
  return { entries, maaps, payableBricks, physicalBricks, earnings: paiseToRupees(earningsPaise) };
};

const byTeamThenDate = (a, b) => a.teamId.localeCompare(b.teamId) || a.date.localeCompare(b.date);
const newestFirst = (a, b) => b.date.localeCompare(a.date) || a.teamId.localeCompare(b.teamId);
const stateFilter = (includeDeleted) => (includeDeleted ? {} : live);
const dateRange = (from, to) => (from || to ? { date: { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) } } : {});

// ---------- Reads ----------

/** One day: every live entry (voided only when asked) plus the day's totals over live entries. */
export const getDay = async (date, { includeDeleted = false, teamId } = {}) => {
  const rows = (await ProductionEntry.find({ date, ...(teamId ? { teamId } : {}), ...stateFilter(includeDeleted) }).lean()).sort(byTeamThenDate);
  return { date, items: rows.map(toEntryDto), summary: toSummaryDto(rows.filter((r) => !r.isDeleted)) };
};

/** Date range and/or one season and/or one team, newest first, paged. `summary` covers every live match, not only the page. */
export const listRange = async ({ from, to, teamId, seasonId, includeDeleted = false, page = 1, limit = 100 }) => {
  const filter = { ...stateFilter(includeDeleted), ...dateRange(from, to), ...(teamId ? { teamId } : {}), ...(seasonId ? { seasonId } : {}) };
  const [total, rows, all] = await Promise.all([
    ProductionEntry.countDocuments(filter),
    ProductionEntry.find(filter).sort({ date: -1, teamId: 1 }).skip((page - 1) * limit).limit(limit).lean(),
    ProductionEntry.find({ ...filter, ...live }).lean(),
  ]);
  return { items: rows.map(toEntryDto), page, limit, total, summary: toSummaryDto(all) };
};

const loadEntry = async (id) => {
  const [row] = await ProductionEntry.find({ _id: id }).lean();
  if (!row) throw ApiError.notFound("Production entry not found");
  return row;
};

/** One entry with its correction trail. */
export const getEntry = async (id) => toDetailDto(await loadEntry(id));

/** A team's history, newest first, with the totals of its live entries. Empty for anyone who is not Patlavale. */
export const getTeamHistory = async (teamId, { from, to, seasonId, includeDeleted = false } = {}) => {
  const [team] = await Labour.find({ _id: teamId }).lean();
  if (!team) throw ApiError.notFound("Labour not found");
  const filter = { teamId, ...stateFilter(includeDeleted), ...dateRange(from, to), ...(seasonId ? { seasonId } : {}) };
  const rows = team.labourType === LABOUR_TYPES.PATLAVALE ? (await ProductionEntry.find(filter).lean()).sort(newestFirst) : [];
  return { items: rows.map(toEntryDto), summary: toSummaryDto(rows.filter((r) => !r.isDeleted)) };
};

/**
 * Season totals: the season, its overall production and one line per team. Built only from the season's live entries, so
 * a salary payment (which is not an entry) can never reduce it. Voided entries are left out.
 */
export const getSeasonProduction = async (seasonId) => {
  const season = await loadSeason(seasonId);
  const rows = await ProductionEntry.find({ seasonId: String(season._id), ...live }).lean();
  const ids = [...new Set(rows.map((r) => r.teamId))].sort();
  const teams = new Map((await Labour.find({ _id: { $in: ids } }).lean()).map((t) => [String(t._id), t]));
  return {
    season: toSeasonDto(season),
    summary: toSummaryDto(rows),
    teams: ids.map((id) => ({ teamId: id, name: teams.get(id)?.name ?? null, ...toSummaryDto(rows.filter((r) => r.teamId === id)) })),
  };
};

// ---------- Write: save one day ----------

const assertSeasonOpen = (season, field = "date") => {
  if (season.status === SEASON_STATUS.CLOSED) throw fieldError(409, `${season.name} is closed. Reopen it to change production in it.`, field);
};

const rowErrors = ({ rows, date, teams, existing, rates }) => {
  const errors = [];
  rows.forEach((row, i) => {
    const add = (message) => errors.push({ field: `rows.${i}.teamId`, message });
    const team = teams.get(row.teamId);
    if (!team) return add("Team not found");
    if (team.labourType !== LABOUR_TYPES.PATLAVALE) return add("Production is only for Patlavale families / teams");
    if (team.joiningDate > date) return add(`Joined on ${team.joiningDate}, after this date`);
    if (team.status !== LABOUR_STATUS.ACTIVE && !existing.has(row.teamId)) return add("This team is inactive and has no entry for this date");
    if (!existing.has(row.teamId) && ratePaiseAt(rates.get(row.teamId), date) === null) return add("This team has no rate set");
    return undefined;
  });
  return errors;
};

/**
 * Save one day. rows: [{ teamId, maaps, note? }], at most one per team.
 * New team/date -> a new entry with the rate in force that day, placed in the season covering the date.
 * Existing entry -> corrected in place (its own rate and season kept). Returns the whole day plus created / updated / unchanged counts.
 */
export const saveDay = async (date, { rows, reason }, actor, now = new Date()) => {
  const today = todayBusinessDate(now);
  if (isFutureBusinessDate(date, now)) throw fieldError(400, `Production cannot be saved for a future date (today is ${today})`, "date");

  const season = seasonForDate(await listSeasonRows(), date);
  if (!season) throw fieldError(400, `No season covers ${date}. Create a season for this date first.`, "date");
  assertSeasonOpen(season);
  const seasonId = String(season._id);

  const ids = rows.map((r) => r.teamId);
  const [teamRows, existingRows, rateRows] = await Promise.all([
    Labour.find({ _id: { $in: ids } }).lean(),
    ProductionEntry.find({ date, teamId: { $in: ids }, ...live }).lean(),
    LabourRateHistory.find({ labourId: { $in: ids } }).lean(),
  ]);
  const teams = new Map(teamRows.map((l) => [String(l._id), l]));
  const existing = new Map(existingRows.map((e) => [e.teamId, e]));
  const rates = new Map();
  for (const r of rateRows) rates.set(r.labourId, [...(rates.get(r.labourId) ?? []), r]);
  for (const [id, list] of rates) rates.set(id, sortRatesAsc(list));

  const errors = rowErrors({ rows, date, teams, existing, rates });
  if (errors.length) throw ApiError.badRequest("Some rows cannot be saved. Nothing was saved.", errors);

  const noteOf = (row) => row.note ?? "";
  const changes = rows.filter((row) => {
    const before = existing.get(row.teamId);
    return !before || before.numberOfMaaps !== row.maaps || (before.note ?? "") !== noteOf(row);
  });
  const backdated = date < today;
  if (backdated && changes.length > 0 && !reason) throw fieldError(400, "A reason is required when changing a day before today", "reason");

  const actorId = actor.id ?? null;
  const counts = { created: 0, updated: 0, unchanged: rows.length - changes.length };
  const conflicts = [];

  await Promise.all(
    rows.map(async (row, i) => {
      const before = existing.get(row.teamId);
      const conflict = () => conflicts.push({ field: `rows.${i}.teamId`, message: "Changed by someone else while saving. Reload and try again." });
      if (before && before.numberOfMaaps === row.maaps && (before.note ?? "") === noteOf(row)) return;

      if (!before) {
        const ratePaise = ratePaiseAt(rates.get(row.teamId), date);
        const { payableBricks, earningsPaise } = calculateProduction(row.maaps, ratePaise);
        try {
          const result = await ProductionEntry.updateOne(
            { teamId: row.teamId, date, ...live },
            {
              $setOnInsert: {
                teamId: row.teamId,
                seasonId,
                date,
                numberOfMaaps: row.maaps,
                payableBricks,
                ratePaise,
                earningsPaise,
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
          else conflict();
        } catch (err) {
          if (!isDuplicateKey(err)) throw err;
          conflict();
        }
        return;
      }

      const { payableBricks, earningsPaise } = calculateProduction(row.maaps, before.ratePaise);
      const result = await ProductionEntry.updateOne(
        { _id: before._id, revision: before.revision, ...live },
        {
          $set: { numberOfMaaps: row.maaps, payableBricks, earningsPaise, note: noteOf(row), updatedBy: actorId },
          $inc: { revision: 1 },
          $push: {
            history: {
              at: now,
              by: actor.name,
              byId: actorId,
              reason: reason ?? DEFAULT_CORRECTION_REASON,
              before: { seasonId: before.seasonId, date: before.date, numberOfMaaps: before.numberOfMaaps, payableBricks: before.payableBricks, note: before.note ?? "", earningsPaise: before.earningsPaise },
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

/** Correct date, maaps and/or note. The rate snapshot stays; payable bricks and earnings are recalculated; a new date re-places the entry in the season covering it. */
export const correctEntry = async (id, { date, newMaaps, note, reason }, actor, now = new Date()) => {
  const entry = await loadEntry(id);
  if (entry.isDeleted) throw ApiError.conflict("A deleted entry cannot be corrected");
  assertSeasonOpen(await loadSeason(entry.seasonId), "date");

  const next = { date: date ?? entry.date, numberOfMaaps: newMaaps ?? entry.numberOfMaaps, note: note ?? entry.note ?? "", seasonId: entry.seasonId };
  if (next.date === entry.date && next.numberOfMaaps === entry.numberOfMaaps && next.note === (entry.note ?? "")) return toDetailDto(entry);

  if (next.date !== entry.date) {
    if (isFutureBusinessDate(next.date, now)) throw fieldError(400, `The date cannot be in the future (today is ${todayBusinessDate(now)})`, "date");
    const [team] = await Labour.find({ _id: entry.teamId }).lean();
    if (team && team.joiningDate > next.date) throw fieldError(400, `Joined on ${team.joiningDate}, after this date`, "date");
    const season = seasonForDate(await listSeasonRows(), next.date);
    if (!season) throw fieldError(400, `No season covers ${next.date}. Create a season for this date first.`, "date");
    assertSeasonOpen(season);
    next.seasonId = String(season._id);
    if ((await ProductionEntry.find({ teamId: entry.teamId, date: next.date, ...live }).lean()).length) throw fieldError(409, "This team already has an entry for that date", "date");
  }

  const { payableBricks, earningsPaise } = calculateProduction(next.numberOfMaaps, entry.ratePaise);
  const actorId = actor.id ?? null;
  try {
    const result = await ProductionEntry.updateOne(
      { _id: entry._id, revision: entry.revision, ...live },
      {
        $set: { ...next, payableBricks, earningsPaise, updatedBy: actorId },
        $inc: { revision: 1 },
        $push: {
          history: {
            at: now,
            by: actor.name,
            byId: actorId,
            reason,
            before: { seasonId: entry.seasonId, date: entry.date, numberOfMaaps: entry.numberOfMaaps, payableBricks: entry.payableBricks, note: entry.note ?? "", earningsPaise: entry.earningsPaise },
          },
        },
      }
    );
    if (result.matchedCount !== 1) throw ApiError.conflict("This entry was changed by someone else. Reload and try again.");
  } catch (err) {
    if (isDuplicateKey(err)) throw fieldError(409, "This team already has an entry for that date", "date");
    throw err;
  }
  return getEntry(id);
};

/** Soft delete: the entry stays (who, when, why) and is left out of every total. A new entry can then be made for that day. */
export const deleteEntry = async (id, { reason }, actor, now = new Date()) => {
  const entry = await loadEntry(id);
  if (entry.isDeleted) throw ApiError.conflict("This entry is already deleted");
  assertSeasonOpen(await loadSeason(entry.seasonId), "id");
  const result = await ProductionEntry.updateOne(
    { _id: entry._id, ...live },
    { $set: { isDeleted: true, deletedAt: now, deletedBy: actor.name, deletedReason: reason, updatedBy: actor.id ?? null } }
  );
  if (result.matchedCount !== 1) throw ApiError.conflict("This entry was changed by someone else. Reload and try again.");
  return getEntry(id);
};
