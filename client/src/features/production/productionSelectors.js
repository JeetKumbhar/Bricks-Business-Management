import { addDaysISO } from "../../utils/formatDate";
import { summarizeProduction } from "../../utils/productionCalculations";

/** teamId: "ALL" or a team id. period: "ALL" | "TODAY" | "WEEK" (today and the 6 days before). */
export const filterProductionEntries = (entries, { teamId = "ALL", period = "ALL", today }) => {
  const weekStart = addDaysISO(today, -6);
  return entries.filter((e) => {
    if (teamId !== "ALL" && e.teamId !== teamId) return false;
    if (period === "TODAY" && e.date !== today) return false;
    if (period === "WEEK" && e.date < weekStart) return false;
    return true;
  });
};

/**
 * Season-to-date totals. `entries` must be oldest first.
 * For several teams each team's ledger is summed on its own (carry-forward belongs to a team, never shared).
 */
export const summarizeSeason = (entries) => {
  const byTeam = {};
  entries.forEach((e) => (byTeam[e.teamId] ||= []).push(e));

  return Object.values(byTeam)
    .map((teamEntries) => summarizeProduction(teamEntries))
    .reduce(
      (total, s) => ({
        totalPhysicalBricks: total.totalPhysicalBricks + s.totalPhysicalBricks,
        totalPayableBricks: total.totalPayableBricks + s.totalPayableBricks,
        carryForwardBricks: total.carryForwardBricks + s.carryForwardBricks,
        totalEarnings: total.totalEarnings + s.totalEarnings,
      }),
      { totalPhysicalBricks: 0, totalPayableBricks: 0, carryForwardBricks: 0, totalEarnings: 0 }
    );
};
