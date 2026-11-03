import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { truckTripService } from "../services/truckTripService";

const TruckTripContext = createContext(null);

/**
 * Holds the Pheera (truck trip) records. All reads and writes go through services/truckTripService.js,
 * so replacing the mock with the real API changes nothing here. Pheera are separate from labour earnings:
 * nothing in this store touches attendance, work entries, production or payments.
 */
export function TruckTripProvider({ children, service = truckTripService }) {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  useEffect(() => {
    let alive = true;
    service
      .listPheeras()
      .then((list) => {
        if (alive) setRecords(list);
      })
      .catch((error) => {
        if (alive) setLoadError(error.message ?? "Could not load Pheera records");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [service]);

  const refresh = useCallback(async () => setRecords(await service.listPheeras()), [service]);

  /** input: { batchId, businessDate, truckId, drafts, trucks, today } -> { records, duplicate } */
  const savePheeraBatch = useCallback(
    async (input) => {
      const result = await service.savePheeraBatch(input);
      await refresh();
      return result;
    },
    [service, refresh]
  );

  const deletePheera = useCallback(
    async (id, reason) => {
      const result = await service.deletePheera(id, reason);
      await refresh();
      return result;
    },
    [service, refresh]
  );

  const value = useMemo(
    () => ({ records, loading, loadError, savePheeraBatch, deletePheera }),
    [records, loading, loadError, savePheeraBatch, deletePheera]
  );

  return <TruckTripContext.Provider value={value}>{children}</TruckTripContext.Provider>;
}

export function useTruckTripStore() {
  const context = useContext(TruckTripContext);
  if (!context) throw new Error("useTruckTripStore must be used inside <TruckTripProvider>");
  return context;
}
