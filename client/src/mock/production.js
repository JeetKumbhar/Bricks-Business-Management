// Patlavale production ledger (one entry per production record, oldest first per team). Shape:
// { id, teamId, seasonId, date, newPhysicalBricks, previousCarryBricks, physicalAvailable,
//   completedGroups, newPayableBricks, carryForwardBricks, ratePer1000PayableBricks, newEarnings, note }
// Derived fields are stored here as a snapshot (like an audit ledger). Whether the backend stores them or
// recalculates them from the raw entries is decided when the backend is designed.
// Payments never reset these totals.
import { calculateProductionEntry } from "../utils/productionCalculations";
import { toISODate } from "../utils/formatDate";
import { patlavaleRecords } from "./labours";
import { CURRENT_SEASON_ID } from "./seasons";

const daysAgo = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return toISODate(d);
};

const ENTRY_DAYS = 25;

export const initialProductionEntries = patlavaleRecords.flatMap((team, t) => {
  let carry = 0;
  return Array.from({ length: ENTRY_DAYS }, (_, i) => {
    const newPhysicalBricks = 800 + ((t * 7 + i * 11) % 13) * 100; // 800..2,000
    const calculated = calculateProductionEntry({
      newPhysicalBricks,
      previousCarryBricks: carry,
      ratePer1000PayableBricks: team.ratePer1000PayableBricks,
    });
    carry = calculated.carryForwardBricks;

    return {
      id: `prod-${team.id}-${i + 1}`,
      teamId: team.id,
      seasonId: CURRENT_SEASON_ID,
      date: daysAgo(ENTRY_DAYS - i),
      ...calculated,
      note: "",
    };
  });
});
