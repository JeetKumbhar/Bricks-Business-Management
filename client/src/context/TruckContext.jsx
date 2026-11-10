import { createContext, useContext, useEffect, useMemo, useSyncExternalStore } from "react";
import { createTruckStore } from "../features/trucks/truckStore";
import * as truckApi from "../services/truckApi";

const TruckContext = createContext(null);

/**
 * The truck store for the screens. The logic is in features/trucks/truckStore.js (server data only, no sample-data fallback);
 * this component only connects it to React. While loading `status` is "loading"; if the server cannot be read it is "error"
 * (with `reload`). The server has no maintenance records and no truck cost, so `maintenance` is always an empty list.
 * Trucks are separate from labour earnings. `api` can be replaced in tests.
 */
export function TruckProvider({ children, api = truckApi }) {
  const store = useMemo(() => createTruckStore(api), [api]);
  const state = useSyncExternalStore(store.subscribe, store.getState);

  useEffect(() => {
    store.load();
    return store.stop;
  }, [store]);

  const value = useMemo(
    () => ({
      trucks: state.trucks,
      status: state.status,
      loadError: state.loadError,
      loading: state.status === "loading",
      reload: store.load,
      maintenance: [],
      isTruckNumberTaken: store.isTruckNumberTaken,
      addTruck: store.addTruck,
      updateTruck: store.updateTruck,
      changeStatus: store.changeStatus,
      histories: state.histories,
      loadHistory: store.loadHistory,
    }),
    [state, store]
  );

  return <TruckContext.Provider value={value}>{children}</TruckContext.Provider>;
}

export function useTruckStore() {
  const context = useContext(TruckContext);
  if (!context) throw new Error("useTruckStore must be used inside <TruckProvider>");
  return context;
}
