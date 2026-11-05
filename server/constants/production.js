// Patlavale production limits and season states. The maap limit is the same technical guard as Maapvali work.
export { DEFAULT_CORRECTION_REASON, MAX_MAAPS_PER_ENTRY, MAX_NOTE_LENGTH, MAX_ROWS_PER_SAVE } from "./maapvali.js";

export const SEASON_STATUS = Object.freeze({ OPEN: "OPEN", CLOSED: "CLOSED" });
export const SEASON_STATUS_VALUES = Object.freeze(Object.values(SEASON_STATUS));
export const MAX_SEASON_NAME_LENGTH = 60;
// An open-ended season (no end date yet) is treated as ending here when checking that seasons do not overlap.
export const FAR_FUTURE_DATE = "9999-12-31";
