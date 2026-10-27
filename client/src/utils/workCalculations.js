// PROTOTYPE calculations (frontend only). Final financial calculations belong to the backend.
// Maapvali: earnings = maaps / 4 x the worker's ratePerFourMaaps; every maap is paid (see dailyWorkCalculations.js).
// Attendance and the Patlavale brick conversion are never used for Maapvali.
import { BRICKS_PER_MAAP } from "./labourTypes";

// Technical limit only (guards typing mistakes such as an extra digit); not a business rule.
export const MAX_MAAPS_PER_ENTRY = 9999;

/**
 * Approximate bricks moved: maaps x 275. INFORMATION ONLY - it never changes earnings or any balance.
 */
export const estimateBricks = (maaps) => maaps * BRICKS_PER_MAAP;

/**
 * Checks the number of maaps typed by the user. Returns an error message, or null when it is valid.
 * Rule: a whole number of 0 or more (0 = the owner explicitly recorded no work that day; blank is "not entered").
 * Negative and fractional values are rejected. This is the only place to change if the client allows half maaps.
 */
export const validateMaapCount = (text) => {
  const raw = String(text ?? "").trim();
  if (raw === "") return "Enter the number of maaps";

  const value = Number(raw);
  if (!Number.isFinite(value)) return "Enter a valid number";
  if (value < 0) return "Maaps cannot be negative";
  if (!Number.isInteger(value)) return "Maaps must be a whole number";
  if (value > MAX_MAAPS_PER_ENTRY) return `Maaps cannot be more than ${MAX_MAAPS_PER_ENTRY}`;
  return null;
};

/** Totals for a list of entries. */
export const summarizeMaapWork = (entries = []) => {
  const maaps = entries.reduce((total, e) => total + e.numberOfMaaps, 0);
  return {
    entries: entries.length,
    maaps,
    earnings: entries.reduce((total, e) => total + e.earnings, 0),
    estimatedBricks: estimateBricks(maaps),
  };
};
