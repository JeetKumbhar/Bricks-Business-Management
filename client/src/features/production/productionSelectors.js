import { getPatlavaleCalculation } from "../../utils/dailyWorkCalculations";
import { addDaysISO } from "../../utils/formatDate";
import { LABOUR_STATUS } from "../../utils/labourStatus";
import { buildDailyRows, summarizeDay } from "../work/shared/dailyRows";
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
 * Season-to-date totals over every entry given. Maaps, physical bricks, payable bricks and earnings are shown separately.
 * Payments never change them.
 */
export const summarizeSeason = (entries) => summarizeProduction(entries);

/** Who is on the daily sheet: ACTIVE teams that had joined by that date. Inactive teams keep their history elsewhere. */
export const getDailyTeamRoster = (teams, date) =>
  teams.filter((t) => t.status === LABOUR_STATUS.ACTIVE && t.joiningDate <= date);

const TEAM_ROWS = {
  idKey: "teamId",
  enteredKey: "newMaaps",
  rateOf: (team) => team.ratePer1000PayableBricks,
  savedRateOf: (entry) => entry.ratePer1000PayableBricks,
  calculate: getPatlavaleCalculation,
};

/** One row per rostered team for the selected date (see features/work/shared/dailyRows.js). */
export const buildProductionDailyRows = ({ roster, entries, date, draft }) =>
  buildDailyRows({ roster, entries, date, draft, config: TEAM_ROWS });

export const summarizeProductionDay = summarizeDay;
