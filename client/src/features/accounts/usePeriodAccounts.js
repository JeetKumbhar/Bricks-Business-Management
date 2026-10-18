import { useMemo } from "react";
import useLabours from "../labours/useLabours";
import { buildPeriodAccounts, summarizePeriod } from "./periodAccounts";

/** Per-labour and per-type figures for a date range (used by Salary and Reports). */
export default function usePeriodAccounts(start, end) {
  const { allLabours, getAttendance, allMaapEntries, allProductionEntries, allPayments } = useLabours();

  return useMemo(() => {
    const rows = buildPeriodAccounts({
      labours: allLabours,
      getAttendance,
      maapEntries: allMaapEntries,
      productionEntries: allProductionEntries,
      payments: allPayments,
      start,
      end,
    });
    return { rows, summary: summarizePeriod(rows) };
  }, [allLabours, getAttendance, allMaapEntries, allProductionEntries, allPayments, start, end]);
}
