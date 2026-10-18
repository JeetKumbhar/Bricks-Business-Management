import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { applyDriverChange, applyStatusChange, createServiceRecord, createTruck, normalizeTruckNumber } from "../features/trucks/truckOps";
import { initialMaintenance, initialTruckHistory, initialTrucks } from "../mock/trucks";
import { toISODate } from "../utils/formatDate";

const TruckContext = createContext(null);

// TODO (auth phase): use the logged-in user.
const CURRENT_USER = "Ramesh Patel";

/**
 * In-memory truck store (mock phase). Trucks are separate from labour accounts:
 * nothing here changes attendance, work entries, production or payments.
 * Later: replace with API calls (services/api.js) - keep the same functions.
 */
export function TruckProvider({ children }) {
  const [trucks, setTrucks] = useState(initialTrucks);
  const [history, setHistory] = useState(initialTruckHistory);
  const [maintenance, setMaintenance] = useState(initialMaintenance);

  const isTruckNumberTaken = useCallback(
    (number, excludeId) => trucks.some((t) => t.id !== excludeId && t.truckNumber === normalizeTruckNumber(number)),
    [trucks]
  );

  const addTruck = useCallback((values) => {
    const { truck, historyEntry } = createTruck(values, { changedBy: CURRENT_USER });
    setTrucks((prev) => [...prev, truck]);
    setHistory((prev) => [...prev, historyEntry]);
    return truck;
  }, []);

  /** Edit number / model / capacity. A driver change is also written to the history. */
  const updateTruck = useCallback(
    (id, changes, { describeDriver } = {}) => {
      const current = trucks.find((t) => t.id === id);
      if (!current) return;
      const next = {
        ...current,
        truckNumber: normalizeTruckNumber(changes.truckNumber ?? current.truckNumber),
        model: (changes.model ?? current.model).trim(),
        capacity: changes.capacity === undefined ? current.capacity : changes.capacity,
      };
      let updated = next;
      if (changes.driverId !== undefined && (changes.driverId || null) !== current.driverId) {
        const result = applyDriverChange({ truck: next, driverId: changes.driverId, describe: describeDriver ?? "Driver changed", changedBy: CURRENT_USER });
        updated = result.truck;
        setHistory((prev) => [...prev, result.historyEntry]);
      }
      setTrucks((prev) => prev.map((t) => (t.id === id ? updated : t)));
    },
    [trucks]
  );

  /** input: { status, reason, note, description, cost } - see applyStatusChange for the rules. */
  const changeStatus = useCallback(
    (id, input) => {
      const current = trucks.find((t) => t.id === id);
      const result = applyStatusChange({ truck: current, input, changedBy: CURRENT_USER, today: toISODate() });
      setTrucks((prev) => prev.map((t) => (t.id === id ? result.truck : t)));
      setHistory((prev) => [...prev, result.historyEntry]);
      setMaintenance((prev) => {
        let next = prev;
        if (result.completeMaintenance) {
          const { truckId, date, cost } = result.completeMaintenance;
          next = next.map((m) =>
            m.truckId === truckId && m.status === "OPEN" ? { ...m, status: "COMPLETED", completedDate: date, cost: cost ?? m.cost } : m
          );
        }
        return result.addMaintenance ? [...next, result.addMaintenance] : next;
      });
    },
    [trucks]
  );

  const addServiceRecord = useCallback((truckId, values) => {
    setMaintenance((prev) => [...prev, createServiceRecord({ truckId, ...values })]);
  }, []);

  const getHistory = useCallback(
    (truckId) => history.filter((h) => h.truckId === truckId).sort((a, b) => b.changedAt.localeCompare(a.changedAt)),
    [history]
  );
  const getMaintenance = useCallback(
    (truckId) => maintenance.filter((m) => m.truckId === truckId).sort((a, b) => b.date.localeCompare(a.date)),
    [maintenance]
  );

  const value = useMemo(
    () => ({ trucks, maintenance, isTruckNumberTaken, addTruck, updateTruck, changeStatus, addServiceRecord, getHistory, getMaintenance }),
    [trucks, maintenance, isTruckNumberTaken, addTruck, updateTruck, changeStatus, addServiceRecord, getHistory, getMaintenance]
  );

  return <TruckContext.Provider value={value}>{children}</TruckContext.Provider>;
}

export function useTruckStore() {
  const context = useContext(TruckContext);
  if (!context) throw new Error("useTruckStore must be used inside <TruckProvider>");
  return context;
}
