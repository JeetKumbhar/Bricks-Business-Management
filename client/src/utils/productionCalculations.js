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
