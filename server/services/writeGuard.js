import { SEASON_STATUS } from "../constants/production.js";
import Season from "../models/Season.js";
import ApiError from "../utils/ApiError.js";

// Closed-season write guards (S4). A CLOSED season's books are final: its workers' closing statements were saved when it was closed, so ordinary
// attendance, Maapvali and payment entries dated inside it can no longer be added, corrected or voided. The only way money is recorded against a
// closed season afterwards is the dedicated final-settlement payment route, which does not use this guard. There is no reopening.
//
// Season detection is by DATE: a season covers startDate..endDate INCLUSIVE; a date outside every season is not guarded; an OPEN season is never a block.
// `assertDatesOpen` is called inside the same transaction as the write (and also before it, for a clear early error). `fenceOpenSeasons` then writes
// to the OPEN season that covers each date, so a season being closed at the same moment conflicts with this write (one of the two retries and sees the
// other) instead of both committing; that is what keeps a closing snapshot and later entries from disagreeing.

export const SEASON_CLOSED_CODE = "SEASON_CLOSED";
const inSession = (query, session) => (session ? query.session(session) : query);
const covers = (season, date) => season.startDate <= date && (season.endDate == null || date <= season.endDate);

const closedError = (season, date, what) =>
  new ApiError(409, `${date} is inside ${season.name} (${season.startDate} to ${season.endDate}), which is closed. ${what} cannot be added, changed or voided in a closed season. Final settlement payments are recorded through the settlement instead.`, [
    { field: "date", message: `${season.name} is closed (${season.startDate} to ${season.endDate}); ordinary entries are not allowed`, code: SEASON_CLOSED_CODE },
  ]);

/** The closed season covering `date`, or null (date outside every season, or inside an open one). */
export const findClosedSeason = async (date, session = null) => {
  const seasons = await inSession(Season.find({ status: SEASON_STATUS.CLOSED }), session).lean();
  return seasons.find((s) => s.endDate && covers(s, date)) ?? null;
};

/** Throws 409 if ANY of the dates falls inside a closed season. `what` names the refused entries, e.g. "Ordinary attendance entries". */
export const assertDatesOpen = async (dates, what, session = null) => {
  const closed = await inSession(Season.find({ status: SEASON_STATUS.CLOSED }), session).lean();
  for (const date of [...new Set(dates)].sort()) {
    const season = closed.find((s) => s.endDate && covers(s, date));
    if (season) throw closedError(season, date, what);
  }
};

/** Inside the write's transaction: touch every OPEN season covering one of the dates so a concurrent close of it cannot commit unseen. */
export const fenceOpenSeasons = async (dates, session) => {
  if (!session) return;
  const seasons = await Season.find({ status: SEASON_STATUS.OPEN }).session(session).lean();
  for (const season of seasons.filter((s) => dates.some((d) => covers(s, d)))) {
    const result = await Season.updateOne({ _id: season._id, status: SEASON_STATUS.OPEN }, { $inc: { writeVersion: 1 } }, { session });
    if (result.matchedCount !== 1) throw ApiError.conflict("The season was closed while this was being saved. Nothing was saved.");
  }
};

/** The one call a write makes first inside its transaction. */
export const guardWrite = async (dates, what, session) => {
  await assertDatesOpen(dates, what, session);
  await fenceOpenSeasons(dates, session);
};
