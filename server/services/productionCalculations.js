// Reusable Patlavale production calculations (no database). Used by the production service now, and by salary, dashboard
// and report code later, so every screen gets the same answer.
//
//   payableBricks = totalMaaps x 250       (1 maap = 250, 3 = 750, 4 = 1,000, 5 = 1,250, 7 = 1,750)
//   earnings      = (totalMaaps / 4) x ratePer1000PayableBricks   (the rate is per 4 maaps = 1,000 payable bricks)
//
// Every maap counts: no flooring to groups of 4, no remainder carried forward, nothing discarded. Physical bricks
// (maaps x 275) are information only and never feed payable bricks or earnings. Money is integer paise, rounded half up
// ONCE per saved daily entry, never on a total. Payments are not an input to anything here.
import { MAX_MAAPS_PER_ENTRY } from "../constants/production.js";
import { earningsPaiseForMaaps, payableBricksForMaaps, physicalBricksForMaaps, sumPaise } from "../utils/money.js";

const assertMaaps = (maaps) => {
  if (!Number.isInteger(maaps) || maaps < 0 || maaps > MAX_MAAPS_PER_ENTRY) {
    throw new RangeError(`maaps must be a whole number from 0 to ${MAX_MAAPS_PER_ENTRY} (got ${maaps})`);
  }
};

/** Payable bricks for a number of maaps: 250 each. */
export const payableBricksFor = (maaps) => {
  assertMaaps(maaps);
  return payableBricksForMaaps(maaps);
};

/** Everything one entry stores that is derived from its maaps and the rate snapshot (paise per 4 maaps). */
export const calculateProduction = (maaps, ratePaise) => {
  assertMaaps(maaps);
  return { payableBricks: payableBricksForMaaps(maaps), physicalBricks: physicalBricksForMaaps(maaps), earningsPaise: earningsPaiseForMaaps(maaps, ratePaise) };
};

/**
 * Totals for a list of entries (rows with numberOfMaaps, payableBricks, earningsPaise). Earnings are the SUM of each entry's
 * own stored earnings, so an old entry keeps the rate it was earned at. Accumulation only: nothing here subtracts.
 */
export const summarizeProduction = (rows = []) => {
  const maaps = rows.reduce((total, r) => total + r.numberOfMaaps, 0);
  return {
    entries: rows.length,
    maaps,
    payableBricks: rows.reduce((total, r) => total + r.payableBricks, 0),
    physicalBricks: physicalBricksForMaaps(maaps),
    earningsPaise: sumPaise(rows.map((r) => r.earningsPaise)),
  };
};
