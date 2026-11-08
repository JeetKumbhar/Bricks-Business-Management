import { FAR_FUTURE_DATE, SEASON_STATUS } from "../constants/production.js";
import ProductionEntry from "../models/ProductionEntry.js";
import Season from "../models/Season.js";
import ApiError from "../utils/ApiError.js";

// Seasons are owner-defined date ranges. A work date belongs to the season whose range covers it; ranges may not overlap,
// so there is at most one. A season is never deleted: it is closed (read-only for production) or reopened.

const fieldError = (status, message, field) => new ApiError(status, message, [{ field, message }]);
const isDuplicateKey = (err) => err?.code === 11000;
const endOf = (s) => s.endDate ?? FAR_FUTURE_DATE;

export const toSeasonDto = (row) => ({
  id: String(row._id),
  name: row.name,
  startDate: row.startDate,
  endDate: row.endDate ?? null,
  status: row.status,
  revision: row.revision ?? 1,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

/** The season covering `date`, or undefined. `seasons` are plain rows ({ _id, startDate, endDate }). */
export const seasonForDate = (seasons, date) => seasons.find((s) => s.startDate <= date && date <= endOf(s));

export const listSeasonRows = async () => (await Season.find({}).lean()).sort((a, b) => b.startDate.localeCompare(a.startDate));
export const loadSeason = async (id) => {
  const [row] = await Season.find({ _id: id }).lean();
  if (!row) throw ApiError.notFound("Season not found");
  return row;
};

export const listSeasons = async () => (await listSeasonRows()).map(toSeasonDto);
export const getSeason = async (id) => toSeasonDto(await loadSeason(id));

const assertNoOverlap = (others, candidate) => {
  const clash = others.find((s) => candidate.startDate <= endOf(s) && s.startDate <= endOf(candidate));
  if (clash) throw fieldError(409, `These dates overlap "${clash.name}" (${clash.startDate} to ${clash.endDate ?? "ongoing"})`, "startDate");
};

export const createSeason = async ({ name, startDate, endDate = null }, actor) => {
  assertNoOverlap(await listSeasonRows(), { startDate, endDate });
  try {
    const created = await Season.create({ name, startDate, endDate, status: SEASON_STATUS.OPEN, revision: 1, createdBy: actor.id ?? null, updatedBy: actor.id ?? null });
    return toSeasonDto(created.toObject({ transform: false }));
  } catch (err) {
    if (isDuplicateKey(err)) throw fieldError(409, "A season with this name already exists", "name");
    throw err;
  }
};

export const updateSeason = async (id, patch, actor) => {
  const season = await loadSeason(id);
  const next = { name: patch.name ?? season.name, startDate: patch.startDate ?? season.startDate, endDate: patch.endDate === undefined ? season.endDate ?? null : patch.endDate, status: patch.status ?? season.status };
  if (next.endDate && next.endDate < next.startDate) throw fieldError(400, "endDate must be on or after startDate", "endDate");
  if (season.status === SEASON_STATUS.CLOSED && next.status === SEASON_STATUS.CLOSED && (patch.startDate || patch.endDate !== undefined)) {
    throw fieldError(409, "Reopen the season before changing its dates", "status");
  }

  if (next.startDate !== season.startDate || next.endDate !== (season.endDate ?? null)) {
    assertNoOverlap((await listSeasonRows()).filter((s) => String(s._id) !== String(season._id)), next);
    // Moving the dates must never strand production outside its own season.
    const stranded = (await ProductionEntry.find({ seasonId: String(season._id) }).lean()).filter((e) => e.date < next.startDate || e.date > endOf(next));
    if (stranded.length) throw fieldError(409, `${stranded.length} production entr${stranded.length === 1 ? "y falls" : "ies fall"} outside these dates (for example ${stranded[0].date})`, "startDate");
  }

  try {
    const result = await Season.updateOne({ _id: season._id, revision: season.revision }, { $set: { ...next, updatedBy: actor.id ?? null }, $inc: { revision: 1 } });
    if (result.matchedCount !== 1) throw ApiError.conflict("This season was changed by someone else. Reload and try again.");
  } catch (err) {
    if (isDuplicateKey(err)) throw fieldError(409, "A season with this name already exists", "name");
    throw err;
  }
  return getSeason(id);
};
