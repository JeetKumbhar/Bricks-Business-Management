// PROTOTYPE calculations (frontend only). Final financial calculations belong to the backend.
// Maapvali: earnings = numberOfMaaps x that worker's ratePerMaap. Attendance and the Patlavale
// 1,100-to-1,000 conversion are never used for Maapvali.
import { BRICKS_PER_MAAP } from "./labourTypes";

export { calculateMaapEarnings } from "./productionCalculations";

// Technical limit only (guards typing mistakes such as an extra digit); not a business rule.
export const MAX_MAAPS_PER_ENTRY = 9999;

/**
 * Approximate bricks moved: maaps x 275. INFORMATION ONLY - it never changes earnings or any balance.
 */
export const estimateBricks = (maaps) => maaps * BRICKS_PER_MAAP;

/**
 * Checks the number of maaps typed by the user. Returns an error message, or null when it is valid.
 * Rule used for now ([Proposed] - to be confirmed with the client): a whole number of 1 or more.
 * Negative, zero and fractional values are rejected. This is the only place to change if the client decides otherwise
 * (for example, to allow half maaps).
 */
export const validateMaapCount = (text) => {
  const raw = String(text ?? "").trim();
  if (raw === "") return "Enter the number of maaps";

  const value = Number(raw);
  if (!Number.isFinite(value)) return "Enter a valid number";
  if (value < 0) return "Maaps cannot be negative";
  if (!Number.isInteger(value)) return "Maaps must be a whole number";
  if (value === 0) return "Maaps must be at least 1";
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
