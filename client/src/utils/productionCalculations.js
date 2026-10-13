// PROTOTYPE calculations (frontend only). Final financial calculations belong to the backend.
// Plain integer maths, no side effects. See docs/BUSINESS_RULES.md.
import { PAYABLE_BRICKS_PER_GROUP, PHYSICAL_BRICKS_PER_GROUP } from "./labourTypes";

const assertWholeNumber = (value, name) => {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a whole number of 0 or more (got ${value})`);
  }
};

/**
 * Patlavale production entry.
 *   physicalAvailable = newPhysicalBricks + previousCarryBricks
 *   completedGroups   = floor(physicalAvailable / 1100)
 *   newPayableBricks  = completedGroups x 1000
 *   carryForwardBricks = physicalAvailable - completedGroups x 1100
 *   newEarnings       = (newPayableBricks / 1000) x ratePer1000PayableBricks
 * Physical, payable and carry-forward values are always returned separately.
 */
export const calculateProductionEntry = ({ newPhysicalBricks, previousCarryBricks = 0, ratePer1000PayableBricks }) => {
  assertWholeNumber(newPhysicalBricks, "newPhysicalBricks");
  assertWholeNumber(previousCarryBricks, "previousCarryBricks");

  const physicalAvailable = newPhysicalBricks + previousCarryBricks;
  const completedGroups = Math.floor(physicalAvailable / PHYSICAL_BRICKS_PER_GROUP);
  const newPayableBricks = completedGroups * PAYABLE_BRICKS_PER_GROUP;
  const carryForwardBricks = physicalAvailable - completedGroups * PHYSICAL_BRICKS_PER_GROUP;
  const newEarnings = Math.round((newPayableBricks / 1000) * ratePer1000PayableBricks * 100) / 100;

  return {
    newPhysicalBricks,
    previousCarryBricks,
    physicalAvailable,
    completedGroups,
    newPayableBricks,
    carryForwardBricks,
    ratePer1000PayableBricks,
    newEarnings,
  };
};

/** Maapvali earnings = numberOfMaaps x that worker's ratePerMaap (no 1,100-to-1,000 conversion). */
export const calculateMaapEarnings = (numberOfMaaps, ratePerMaap) => {
  assertWholeNumber(numberOfMaaps, "numberOfMaaps");
  return Math.round(numberOfMaaps * ratePerMaap * 100) / 100;
};

/** Season totals for one team from its entries (oldest first). Payments never change these. */
export const summarizeProduction = (entries = []) => ({
  totalPhysicalBricks: entries.reduce((total, e) => total + e.newPhysicalBricks, 0),
  totalPayableBricks: entries.reduce((total, e) => total + e.newPayableBricks, 0),
  carryForwardBricks: entries.length ? entries[entries.length - 1].carryForwardBricks : 0,
  totalEarnings: entries.reduce((total, e) => total + e.newEarnings, 0),
});

// ---------------------------------------------------------------------------
// Ledger helpers. The single formula above (calculateProductionEntry) is the ONLY place the 1,100 -> 1,000
// conversion happens. Everything below calls it; no component repeats the maths.
// ---------------------------------------------------------------------------

// Technical limit only (guards typing mistakes); not a business rule.
export const MAX_BRICKS_PER_ENTRY = 999999;

/**
 * Checks "new physical bricks" typed by the user. Returns an error message, or null when valid.
 * Rule used for now ([Proposed] - to be confirmed with the client): a whole number of 1 or more.
 */
export const validatePhysicalBricks = (text) => {
  const raw = String(text ?? "").trim();
  if (raw === "") return "Enter the number of new physical bricks";

  const value = Number(raw);
  if (!Number.isFinite(value)) return "Enter a valid number";
  if (value < 0) return "Bricks cannot be negative";
  if (!Number.isInteger(value)) return "Bricks must be a whole number";
  if (value === 0) return "Bricks must be at least 1";
  if (value > MAX_BRICKS_PER_ENTRY) return `Bricks cannot be more than ${MAX_BRICKS_PER_ENTRY.toLocaleString("en-IN")}`;
  return null;
};

const ledgerOrder = (a, b) => a.date.localeCompare(b.date) || (a.createdAt ?? "").localeCompare(b.createdAt ?? "");

/**
 * Recalculates one team's entries in date order, chaining the carry-forward from entry to entry.
 * Deleted entries are skipped. Each entry keeps its own rate (a snapshot). Returns the entries oldest first.
 * Needed because a back-dated entry, a correction or a deletion changes the carry of every later entry.
 */
export const recalculateLedger = (entries = []) => {
  const ordered = entries
    .filter((e) => !e.isDeleted)
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => ledgerOrder(a.entry, b.entry) || a.index - b.index)
    .map(({ entry }) => entry);

  let carry = 0;
  return ordered.map((entry) => {
    const calculated = calculateProductionEntry({
      newPhysicalBricks: entry.newPhysicalBricks,
      previousCarryBricks: carry,
      ratePer1000PayableBricks: entry.ratePer1000PayableBricks,
    });
    carry = calculated.carryForwardBricks;
    return { ...entry, ...calculated };
  });
};

const PREVIEW_ID = "__preview__";

/**
 * "What would happen if I saved this?" for the entry form. Works for a new entry (no id) and for a correction (id).
 * candidate: { id?, date, newPhysicalBricks, ratePer1000PayableBricks, createdAt? }
 * Returns { entry (with all derived values), season (season-to-date totals), laterEntriesChanged }.
 */
export const previewLedgerEntry = (teamEntries = [], candidate) => {
  const id = candidate.id ?? PREVIEW_ID;
  const others = teamEntries.filter((e) => !e.isDeleted && e.id !== id);
  const rebuilt = recalculateLedger([
    ...others,
    { ...candidate, id, createdAt: candidate.createdAt ?? "9999-12-31T00:00:00.000Z", isDeleted: false },
  ]);

  // Compare against a fresh calculation of the existing entries (not their stored values), so the answer is
  // right even if a stored derived value is stale.
  const baseline = new Map(recalculateLedger(others).map((e) => [e.id, e]));
  const laterEntriesChanged = others.filter((entry) => {
    const before = baseline.get(entry.id);
    const after = rebuilt.find((e) => e.id === entry.id);
    return (
      after.previousCarryBricks !== before.previousCarryBricks ||
      after.newPayableBricks !== before.newPayableBricks ||
      after.carryForwardBricks !== before.carryForwardBricks
    );
  }).length;

  return { entry: rebuilt.find((e) => e.id === id), season: summarizeProduction(rebuilt), laterEntriesChanged };
};
