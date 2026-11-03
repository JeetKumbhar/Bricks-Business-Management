import { useCallback, useMemo } from "react";
import { useTruckStore } from "../../context/TruckContext";
import { useTruckTripStore } from "../../context/TruckTripContext";
import { todayBusinessDate } from "../../utils/businessDate";
import { decoratePheeras, knownDestinations } from "./pheeraSelectors";

/** Pheera rows (active only, with the current truck registration), plus save / delete bound to the current trucks. */
export default function useTruckTrips() {
  const { trucks } = useTruckStore();
  const store = useTruckTripStore();

  const rows = useMemo(() => decoratePheeras(store.records, trucks), [store.records, trucks]);
  const destinations = useMemo(() => knownDestinations(rows), [rows]);

  const savePheeraBatch = useCallback(
    (input) => store.savePheeraBatch({ ...input, trucks, today: todayBusinessDate() }),
    [store, trucks]
  );

  return {
    trucks,
    rows,
    allRecords: store.records, // includes soft-deleted ones (numbering needs them)
    destinations,
    loading: store.loading,
    loadError: store.loadError,
    savePheeraBatch,
    deletePheera: store.deletePheera,
  };
}
