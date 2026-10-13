import { useCallback, useMemo } from "react";
import useLabours from "../labours/useLabours";
import { LABOUR_STATUS } from "../../utils/labourStatus";
import { LABOUR_TYPES } from "../../utils/labourTypes";
import { previewLedgerEntry } from "../../utils/productionCalculations";

/**
 * Patlavale teams + their production entries (oldest first, with the team name added), the "what if" preview
 * used by the entry form, and the add / correct / delete actions.
 * Backed by LabourProvider (in-memory mock) for now.
 */
export default function useProduction() {
  const { allLabours, allProductionEntries, addProductionEntry, updateProductionEntry, deleteProductionEntry } = useLabours();

  const teams = useMemo(() => allLabours.filter((l) => l.labourType === LABOUR_TYPES.PATLAVALE), [allLabours]);
  // New production can only be recorded for active teams.
  const activeTeams = useMemo(() => teams.filter((t) => t.status === LABOUR_STATUS.ACTIVE), [teams]);

  const entries = useMemo(() => {
    const byId = Object.fromEntries(teams.map((t) => [t.id, t]));
    return allProductionEntries.filter((e) => byId[e.teamId]).map((e) => ({ ...e, teamName: byId[e.teamId].name }));
  }, [teams, allProductionEntries]);

  /**
   * candidate: { teamId, date, newPhysicalBricks, ratePer1000PayableBricks, id? (when correcting) }
   * Returns { entry, season, laterEntriesChanged } from the one calculation module.
   */
  const preview = useCallback(
    (candidate) =>
      previewLedgerEntry(
        entries.filter((e) => e.teamId === candidate.teamId),
        candidate
      ),
    [entries]
  );

  return { teams, activeTeams, entries, preview, addProductionEntry, updateProductionEntry, deleteProductionEntry };
}
