
// Maapvali daily maap work entries. Shape:
// { id, labourId, seasonId, date, numberOfMaaps, ratePerMaap (rate on that day), earnings, note }
// earnings = numberOfMaaps x ratePerMaap. Attendance is NOT used for Maapvali earnings.
import { calculateMaapEarnings } from "../utils/productionCalculations";
import { toISODate } from "../utils/formatDate";
import { maapvaliRecords } from "./labours";
import { CURRENT_SEASON_ID } from "./seasons";

const daysAgo = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return toISODate(d);
};

export const initialMaapEntries = maapvaliRecords.flatMap((worker, k) => {
  const lastDay = worker.status === "INACTIVE" ? 10 : 1; // an inactive worker stopped working earlier
  return Array.from({ length: 12 }, (_, i) => lastDay + i)
    .filter((_, i) => (i + k) % 5 !== 4) // a few days with no maap work
    .map((daysBack) => {
      const numberOfMaaps = 24 + ((k * 13 + daysBack * 7) % 21); // 24..44
      return {
        id: `maap-${worker.id}-${daysBack}`,
        labourId: worker.id,
        seasonId: CURRENT_SEASON_ID,
        date: daysAgo(daysBack),
        numberOfMaaps,
        ratePerMaap: worker.ratePerMaap,
        earnings: calculateMaapEarnings(numberOfMaaps, worker.ratePerMaap),
        note: "",
      };
    });
});
