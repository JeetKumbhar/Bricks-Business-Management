import { useMemo } from "react";
import { useTruckStore } from "../../context/TruckContext";
import { isEligibleDriver } from "../../utils/truckStatus";
import useLabours from "../labours/useLabours";
import { summarizeTrucks } from "./truckSummary";

/** Trucks with the driver's name added, status counts, and the eligible driver list. */
export default function useTrucks() {
  const store = useTruckStore();
  const { allLabours } = useLabours();

  const eligibleDrivers = useMemo(() => allLabours.filter(isEligibleDriver), [allLabours]);

  const trucks = useMemo(() => {
    const byId = Object.fromEntries(allLabours.map((l) => [l.id, l]));
    return store.trucks.map((t) => ({
      ...t,
      driverName: t.driverId ? (byId[t.driverId]?.name ?? t.driverId) : null,
      driverType: t.driverId ? byId[t.driverId]?.labourType : null,
    }));
  }, [store.trucks, allLabours]);

  const summary = useMemo(() => summarizeTrucks(trucks), [trucks]);

  return { ...store, trucks, summary, eligibleDrivers, allLabours };
}
