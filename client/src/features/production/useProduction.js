import { useCallback, useMemo } from "react";
import useLabours from "../labours/useLabours";
import { deriveProductionEntry } from "../../utils/dailyWorkCalculations";
import { LABOUR_STATUS } from "../../utils/labourStatus";
import { LABOUR_TYPES } from "../../utils/labourTypes";

/**
 * Patlavale teams + their production entries (oldest first, with the team name added), the "what if" preview
 * used by the correction form, and the save-day / correct / delete actions.
 * Daily production is saved with saveProductionDay (one record per team and date). Backed by LabourProvider (in-memory mock).
 */
export default function useProduction() {
  const { allLabours, allProductionEntries, saveProductionDay, updateProductionEntry, deleteProductionEntry } = useLabours();

  const teams = useMemo(() => allLabours.filter((l) => l.labourType === LABOUR_TYPES.PATLAVALE), [allLabours]);
  // New production can only be recorded for active teams.
  const activeTeams = useMemo(() => teams.filter((t) => t.status === LABOUR_STATUS.ACTIVE), [teams]);

  const entries = useMemo(() => {
    const byId = Object.fromEntries(teams.map((t) => [t.id, t]));
    return allProductionEntries.filter((e) => byId[e.teamId]).map((e) => ({ ...e, teamName: byId[e.teamId].name }));
  }, [teams, allProductionEntries]);

  /** "What would this entry produce and earn?" for the correction form. candidate: { newMaaps, ratePer1000PayableBricks }. */
  const preview = useCallback((candidate) => deriveProductionEntry(candidate), []);

  return { teams, activeTeams, entries, preview, saveProductionDay, updateProductionEntry, deleteProductionEntry };
}
