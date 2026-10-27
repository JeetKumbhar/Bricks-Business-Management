
// Maapvali daily maap work entries. One entry per worker per date. Shape:
// { id, labourId, seasonId, date, numberOfMaaps (entered that day), ratePerFourMaaps (rate snapshot), earnings, note }
// earnings = numberOfMaaps / 4 x ratePerFourMaaps. Every maap is paid; there is no carry-forward.
// Attendance is NOT used for Maapvali earnings. Today is left empty so the daily entry page can be demonstrated.
import { deriveMaapEntries } from "../utils/dailyWorkCalculations";
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
  const raw = Array.from({ length: 12 }, (_, i) => lastDay + i)
    .filter((_, i) => (i + k) % 5 !== 4) // a few days with no maap work
    .map((daysBack) => ({
      id: `maap-${worker.id}-${daysBack}`,
      labourId: worker.id,
      seasonId: CURRENT_SEASON_ID,
      date: daysAgo(daysBack),
      numberOfMaaps: 24 + ((k * 13 + daysBack * 7) % 21), // 24..44
      ratePerFourMaaps: worker.ratePerFourMaaps,
      note: "",
      isDeleted: false,
    }));
  return deriveMaapEntries(raw);
});
