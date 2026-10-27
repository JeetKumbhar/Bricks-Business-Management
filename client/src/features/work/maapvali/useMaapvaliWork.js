import { useCallback, useMemo } from "react";
import useLabours from "../../labours/useLabours";
import { LABOUR_STATUS } from "../../../utils/labourStatus";
import { LABOUR_TYPES } from "../../../utils/labourTypes";
import { deriveMaapEntry } from "../../../utils/dailyWorkCalculations";

/**
 * Maapvali workers + their work entries (with the worker name added), and the add / correct / delete actions.
 * Daily work is saved with saveMaapDay (one record per worker and date). Backed by LabourProvider (in-memory mock) for now.
 */
export default function useMaapvaliWork() {
  const { allLabours, allMaapEntries, updateMaapEntry, deleteMaapEntry, saveMaapDay } = useLabours();

  const maapvali = useMemo(() => allLabours.filter((l) => l.labourType === LABOUR_TYPES.MAAPVALI), [allLabours]);
  // New work can only be recorded for active workers.
  const activeWorkers = useMemo(() => maapvali.filter((l) => l.status === LABOUR_STATUS.ACTIVE), [maapvali]);

  const entries = useMemo(() => {
    const byId = Object.fromEntries(maapvali.map((w) => [w.id, w]));
    return allMaapEntries
      .filter((e) => byId[e.labourId])
      .map((e) => ({ ...e, workerName: byId[e.labourId].name }));
  }, [maapvali, allMaapEntries]);

  /** "What would this entry earn?" for the correction form. candidate: { numberOfMaaps, ratePerFourMaaps }. */
  const previewEntry = useCallback((candidate) => deriveMaapEntry(candidate), []);

  return { maapvali, activeWorkers, entries, previewEntry, saveMaapDay, updateMaapEntry, deleteMaapEntry };
}
