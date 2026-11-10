import { createContext, useContext, useEffect, useMemo, useSyncExternalStore } from "react";
import { createPheeraStore } from "../features/trucks/pheeraStore";
import { pheeraService } from "../services/pheeraService";

const TruckTripContext = createContext(null);

/**
 * Holds the Pheera (truck trip) records for the screens. The logic is in features/trucks/pheeraStore.js (server data only, no
 * sample-data fallback); this component only connects it to React. `service` can be replaced in tests.
 */
export function TruckTripProvider({ children, service = pheeraService }) {
  const store = useMemo(() => createPheeraStore(service), [service]);
  const state = useSyncExternalStore(store.subscribe, store.getState);

  useEffect(() => {
    store.load();
    return store.stop;
  }, [store]);

  const value = useMemo(
    () => ({ records: state.records, loading: state.loading, loadError: state.loadError, reload: store.load, savePheeraBatch: store.savePheeraBatch, deletePheera: store.deletePheera }),
    [state, store]
  );

  return <TruckTripContext.Provider value={value}>{children}</TruckTripContext.Provider>;
}

export function useTruckTripStore() {
  const context = useContext(TruckTripContext);
  if (!context) throw new Error("useTruckTripStore must be used inside <TruckTripProvider>");
  return context;
}
