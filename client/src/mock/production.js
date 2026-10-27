// Patlavale production ledger (one entry per team per day, oldest first per team). Shape:
// { id, teamId, seasonId, date, newMaaps (typed that day), newPhysicalBricks (maaps x 275), newPayableBricks (maaps x 250),
//   ratePer1000PayableBricks (= rate per 4 maaps), newEarnings (= maaps / 4 x rate), note }
// 4 maaps = 1,100 physical = 1,000 payable bricks. Every maap is paid; there is no carry-forward.
// Payments never reset these totals. Today is left empty so the daily entry page can be demonstrated.
import { deriveProductionEntries } from "../utils/dailyWorkCalculations";
import { toISODate } from "../utils/formatDate";
import { patlavaleRecords } from "./labours";
import { CURRENT_SEASON_ID } from "./seasons";

const daysAgo = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return toISODate(d);
};

const ENTRY_DAYS = 25;

export const initialProductionEntries = patlavaleRecords.flatMap((team, t) =>
  deriveProductionEntries(
    Array.from({ length: ENTRY_DAYS }, (_, i) => ({
      id: `prod-${team.id}-${i + 1}`,
      teamId: team.id,
      seasonId: CURRENT_SEASON_ID,
      date: daysAgo(ENTRY_DAYS - i),
      newMaaps: 3 + ((t * 7 + i * 11) % 5), // 3..7 maaps a day (about 800-2,000 bricks)
      ratePer1000PayableBricks: team.ratePer1000PayableBricks,
      note: "",
      isDeleted: false,
    }))
  )
);
