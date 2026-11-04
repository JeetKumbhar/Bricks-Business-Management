// Reusable Maapvali calculations (no database). Used by the work-entry service now, and by salary, dashboard and
// report code in later phases, so every screen gets the same answer.
//
//   earnings = (totalMaaps / 4) x ratePerFourMaaps
//
// Every maap is paid in proportion: no flooring to groups of 4, no remainder carried forward, no maaps discarded.
// Worked at 250 rupees per 4 maaps: 1 maap = 62.50, 4 = 250, 5 = 312.50, 41 = 2,562.50.
// All amounts are integer paise. Rounding (half up) happens ONCE per saved daily entry, never on a total.
import { MAX_MAAPS_PER_ENTRY } from "../constants/maapvali.js";
import { PHYSICAL_BRICKS_PER_MAAP, earningsPaiseForMaaps, sumPaise } from "../utils/money.js";

/** Earnings in paise for one entry: maaps / 4 x rate per 4 maaps, rounded half up. `maaps` is a whole number 0..9999. */
export const maapvaliEarningsPaise = (maaps, ratePerFourMaapsPaise) => {
  if (!Number.isInteger(maaps) || maaps < 0 || maaps > MAX_MAAPS_PER_ENTRY) {
    throw new RangeError(`maaps must be a whole number from 0 to ${MAX_MAAPS_PER_ENTRY} (got ${maaps})`);
  }
  return earningsPaiseForMaaps(maaps, ratePerFourMaapsPaise);
};

/**
 * Totals for a list of entries (rows with numberOfMaaps and earningsPaise). Earnings are the SUM of each entry's own
 * stored earnings, so an old entry keeps the rate it was earned at and a rate change never alters the total.
 * estimatedBricks is information only (275 per maap) and never feeds earnings.
 */
export const summarizeMaapEntries = (rows = []) => {
  const maaps = rows.reduce((total, r) => total + r.numberOfMaaps, 0);
  return { entries: rows.length, maaps, earningsPaise: sumPaise(rows.map((r) => r.earningsPaise)), estimatedBricks: maaps * PHYSICAL_BRICKS_PER_MAAP };
};
