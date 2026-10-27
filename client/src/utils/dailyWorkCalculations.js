// PROTOTYPE calculations (frontend only). Final financial calculations belong to the backend.
// Shared by the daily-entry pages for Maapvali workers and Patlavale teams. Pure functions, no side effects.
//
// Both types count work in MAAPS. The rate is CONFIGURED per 4 maaps (= 1,000 payable bricks), but every single maap
// is paid, in proportion:
//   Maapvali  : earnings       = maaps / 4 x ratePerFourMaaps          (41 maaps at 250 per 4 = 2,562.50)
//   Patlavale : payable bricks = maaps x 250                           (5 maaps = 1,250 payable bricks)
//               earnings       = payable bricks / 1,000 x team rate    (= maaps / 4 x rate)
//               physical bricks = maaps x 275 (4 maaps = 1,100 physical), information alongside payable bricks
// There is NO rounding down to groups of 4 and NO carry-forward: each day's entry stands on its own, so editing one day
// never changes another. Payments never change any of these values.
import { BRICKS_PER_MAAP, MAAPS_PER_RATE_UNIT, PAYABLE_BRICKS_PER_MAAP } from "./labourTypes";

// Technical limit only (guards typing mistakes such as an extra digit); not a business rule.
export const MAX_MAAPS_PER_DAY = 9999;

const round2 = (n) => Math.round(n * 100) / 100;

const assertWhole = (value, name) => {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a whole number of 0 or more (got ${value})`);
  }
};

const assertRate = (rate) => {
  if (!Number.isFinite(rate) || rate < 0) throw new RangeError(`rate must be a number of 0 or more (got ${rate})`);
};

/** Pay for `maaps` at a rate per 4 maaps, proportionally (no floor). Rounded to paise. */
export const earningsForMaaps = (maaps, ratePerFourMaaps) => round2((maaps / MAAPS_PER_RATE_UNIT) * ratePerFourMaaps);

/** Maapvali: earnings = maaps / 4 x rate per 4 maaps. Every maap is paid. */
export const getMaapvaliCalculation = ({ maapsEntered, ratePerFourMaaps }) => {
  assertWhole(maapsEntered, "maapsEntered");
  assertRate(ratePerFourMaaps);
  return { maapsEntered, ratePerFourMaaps, earnings: earningsForMaaps(maapsEntered, ratePerFourMaaps) };
};

/**
 * Patlavale: payable bricks = maaps x 250 (4 maaps = 1,000). Physical bricks (maaps x 275) are kept separately.
 */
export const getPatlavaleCalculation = ({ maapsEntered, ratePerFourMaaps }) => {
  assertWhole(maapsEntered, "maapsEntered");
  assertRate(ratePerFourMaaps);
  return {
    maapsEntered,
    payableBricks: maapsEntered * PAYABLE_BRICKS_PER_MAAP,
    physicalBricks: maapsEntered * BRICKS_PER_MAAP,
    ratePerFourMaaps,
    earnings: earningsForMaaps(maapsEntered, ratePerFourMaaps),
  };
};

// ---------------------------------------------------------------------------
// Input parsing. Blank = "not entered yet"; 0 = the owner explicitly recorded zero work.
// ---------------------------------------------------------------------------

/** Returns { status: "blank" } | { status: "ok", value } | { status: "error", message }. */
export const parseDailyMaaps = (text) => {
  const raw = String(text ?? "").trim();
  if (raw === "") return { status: "blank" };

  const value = Number(raw);
  if (!Number.isFinite(value)) return { status: "error", message: "Enter a valid number" };
  if (value < 0) return { status: "error", message: "Maaps cannot be negative" };
  if (!Number.isInteger(value)) return { status: "error", message: "Whole maaps only" };
  if (value > MAX_MAAPS_PER_DAY) return { status: "error", message: `Maximum ${MAX_MAAPS_PER_DAY}` };
  return { status: "ok", value };
};

// ---------------------------------------------------------------------------
// Entry derivation. Each stored entry holds what was typed (maaps) and its rate snapshot; everything else is derived
// from those two numbers alone, so the helpers below never look at any other entry.
// ---------------------------------------------------------------------------

const entryOrder = (a, b) => a.date.localeCompare(b.date) || (a.createdAt ?? "").localeCompare(b.createdAt ?? "");

const liveSorted = (entries) =>
  entries
    .filter((e) => !e.isDeleted)
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => entryOrder(a.entry, b.entry) || a.index - b.index)
    .map(({ entry }) => entry);

/** Adds the derived Maapvali fields (earnings) to one entry. */
export const deriveMaapEntry = (entry) => ({
  ...entry,
  earnings: getMaapvaliCalculation({ maapsEntered: entry.numberOfMaaps, ratePerFourMaaps: entry.ratePerFourMaaps }).earnings,
});

/** Live (not deleted) Maapvali entries in date order, each with its derived fields. */
export const deriveMaapEntries = (entries = []) => liveSorted(entries).map(deriveMaapEntry);

/** Adds the derived Patlavale fields (physical / payable bricks, earnings) to one entry. */
export const deriveProductionEntry = (entry) => {
  const c = getPatlavaleCalculation({ maapsEntered: entry.newMaaps, ratePerFourMaaps: entry.ratePer1000PayableBricks });
  return { ...entry, newPhysicalBricks: c.physicalBricks, newPayableBricks: c.payableBricks, newEarnings: c.earnings };
};

/** Live (not deleted) production entries in date order, each with its derived fields. */
export const deriveProductionEntries = (entries = []) => liveSorted(entries).map(deriveProductionEntry);
