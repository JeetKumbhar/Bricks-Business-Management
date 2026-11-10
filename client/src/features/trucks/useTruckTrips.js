import { useMemo } from "react";
import { useTruckStore } from "../../context/TruckContext";
import { useTruckTripStore } from "../../context/TruckTripContext";
import { decoratePheeras, knownDestinations } from "./pheeraSelectors";

/** Pheera rows (active only, with the current truck registration), plus save / delete. Records come from the server. */
export default function useTruckTrips() {
  const { trucks } = useTruckStore();
  const store = useTruckTripStore();

  const rows = useMemo(() => decoratePheeras(store.records, trucks), [store.records, trucks]);
  const destinations = useMemo(() => knownDestinations(rows), [rows]);


  return {
    trucks,
    rows,
    allRecords: store.records, // includes soft-deleted ones (numbering needs them)
    destinations,
    loading: store.loading,
    loadError: store.loadError,
    savePheeraBatch: store.savePheeraBatch,
    reload: store.reload,
    deletePheera: store.deletePheera,
  };
}
