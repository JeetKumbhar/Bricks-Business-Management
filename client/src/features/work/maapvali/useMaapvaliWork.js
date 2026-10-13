import { useCallback, useMemo } from "react";
import useLabours from "../../labours/useLabours";
import { LABOUR_STATUS } from "../../../utils/labourStatus";
import { LABOUR_TYPES } from "../../../utils/labourTypes";
import { summarizeMaapWork } from "../../../utils/workCalculations";

/**
 * Maapvali workers + their work entries (with the worker name added), and the add / correct / delete actions.
 * Backed by LabourProvider (in-memory mock) for now.
 */
export default function useMaapvaliWork() {
  const { allLabours, allMaapEntries, addMaapEntry, updateMaapEntry, deleteMaapEntry } = useLabours();

  const maapvali = useMemo(() => allLabours.filter((l) => l.labourType === LABOUR_TYPES.MAAPVALI), [allLabours]);
  // New work can only be recorded for active workers.
  const activeWorkers = useMemo(() => maapvali.filter((l) => l.status === LABOUR_STATUS.ACTIVE), [maapvali]);

  const entries = useMemo(() => {
    const byId = Object.fromEntries(maapvali.map((w) => [w.id, w]));
    return allMaapEntries
      .filter((e) => byId[e.labourId])
      .map((e) => ({ ...e, workerName: byId[e.labourId].name }));
  }, [maapvali, allMaapEntries]);

  /** What the worker already has on a date (entries are separate records; a day can have more than one). */
  const getDayTotal = useCallback(
    (labourId, date) => summarizeMaapWork(entries.filter((e) => e.labourId === labourId && e.date === date)),
    [entries]
  );

  return { maapvali, activeWorkers, entries, getDayTotal, addMaapEntry, updateMaapEntry, deleteMaapEntry };
}
