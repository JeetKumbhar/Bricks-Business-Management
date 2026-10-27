import { getMaapvaliCalculation } from "../../../utils/dailyWorkCalculations";
import { addDaysISO } from "../../../utils/formatDate";
import { LABOUR_STATUS } from "../../../utils/labourStatus";
import { buildDailyRows, summarizeDay } from "../shared/dailyRows";

/** period: "ALL" | "TODAY" | "WEEK" (today and the 6 days before). search: worker name, ID or note. */
export const filterMaapEntries = (entries, { search = "", period = "ALL", today }) => {
  const q = search.trim().toLowerCase();
  const weekStart = addDaysISO(today, -6);

  return entries.filter((e) => {
    if (period === "TODAY" && e.date !== today) return false;
    if (period === "WEEK" && e.date < weekStart) return false;
    if (!q) return true;
    return (
      e.workerName.toLowerCase().includes(q) || e.labourId.toLowerCase().includes(q) || (e.note ?? "").toLowerCase().includes(q)
    );
  });
};

/** Who is on the daily sheet: ACTIVE workers who had joined by that date. Inactive workers keep their history elsewhere. */
export const getDailyRoster = (workers, date) =>
  workers.filter((w) => w.status === LABOUR_STATUS.ACTIVE && w.joiningDate <= date);

const MAAP_ROWS = {
  idKey: "labourId",
  enteredKey: "numberOfMaaps",
  rateOf: (worker) => worker.ratePerFourMaaps,
  savedRateOf: (entry) => entry.ratePerFourMaaps,
  calculate: getMaapvaliCalculation,
};

/** One row per rostered worker for the selected date (see features/work/shared/dailyRows.js). */
export const buildMaapDailyRows = ({ roster, entries, date, draft }) =>
  buildDailyRows({ roster, entries, date, draft, config: MAAP_ROWS });

export const summarizeMaapDay = summarizeDay;
