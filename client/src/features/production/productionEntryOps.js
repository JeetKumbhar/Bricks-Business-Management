// Pure functions that create / correct / delete a production entry and keep the team's ledger chained.
// Production entries never touch the payment ledger.
import { LABOUR_TYPES } from "../../utils/labourTypes";
import { calculateProductionEntry, recalculateLedger, validatePhysicalBricks } from "../../utils/productionCalculations";

const assertBricks = (bricks) => {
  const problem = validatePhysicalBricks(bricks);
  if (problem) throw new RangeError(problem);
};

/** The team's rate is copied from its profile at the moment of entry (a snapshot). Derived fields are filled by the re-chain. */
export const createProductionEntry = ({ team, date, newPhysicalBricks, note = "", seasonId, now = new Date() }) => {
  if (!team || team.labourType !== LABOUR_TYPES.PATLAVALE) {
    throw new Error("Production can only be recorded for a Patlavale family / team");
  }
  assertBricks(newPhysicalBricks);

  return {
    id: `prod-${team.id}-${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
    teamId: team.id,
    seasonId,
    date,
    ...calculateProductionEntry({
      newPhysicalBricks,
      previousCarryBricks: 0,
      ratePer1000PayableBricks: team.ratePer1000PayableBricks,
    }),
    note,
    isDeleted: false,
    createdAt: now.toISOString(),
  };
};

/** Correction: date, bricks and note can change; the entry keeps its own rate snapshot. A reason is required. */
export const applyProductionCorrection = (entry, { date, newPhysicalBricks, note }, reason, now = new Date()) => {
  assertBricks(newPhysicalBricks);
  return { ...entry, date, newPhysicalBricks, note, editedReason: reason, updatedAt: now.toISOString() };
};

/** Soft delete: the record stays (traceable), the ledger ignores it. A reason is required. */
export const applyProductionDelete = (entry, reason, now = new Date()) => ({
  ...entry,
  isDeleted: true,
  deletedReason: reason,
  deletedAt: now.toISOString(),
});

/** Recalculates the carry-forward chain of one team inside the full list of entries. */
export const rechainTeamLedger = (allEntries, teamId) => {
  const rebuilt = new Map(
    recalculateLedger(allEntries.filter((e) => e.teamId === teamId && !e.isDeleted)).map((e) => [e.id, e])
  );
  return allEntries.map((e) => rebuilt.get(e.id) ?? e);
};
