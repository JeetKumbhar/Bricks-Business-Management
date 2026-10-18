import { useMemo } from "react";
import { useTruckStore } from "../../context/TruckContext";
import { dashboardData as staticData } from "../../mock/dashboard";
import { toISODate } from "../../utils/formatDate";
import useLabours from "../labours/useLabours";
import { summarizeTrucks, trucksNeedingAttention } from "../trucks/truckSummary";
import { buildDashboardData } from "./dashboardSelectors";

/**
 * Single place the Dashboard gets its data.
 * Everything about labour, attendance, maap work, production and payments is calculated from the same records
 * the other pages use, and trucks come from the Trucks module. Only the owner's details are in mock/dashboard.js.
 * Later: replace with an API call (services/api.js) and add real loading / error state.
 */
export default function useDashboardData() {
  const { allLabours, getAttendanceByDate, getAttendance, allMaapEntries, allProductionEntries, allPayments } = useLabours();
  const { trucks, maintenance } = useTruckStore();
  const today = toISODate();

  return useMemo(
    () => ({
      ...staticData,
      ...buildDashboardData({
        labours: allLabours,
        getAttendanceByDate,
        getAttendance,
        maapEntries: allMaapEntries,
        productionEntries: allProductionEntries,
        payments: allPayments,
        today,
      }),
      trucks: summarizeTrucks(trucks),
      truckAttention: trucksNeedingAttention(trucks, maintenance),
      isLoading: false,
    }),
    [allLabours, getAttendanceByDate, getAttendance, allMaapEntries, allProductionEntries, allPayments, trucks, maintenance, today]
  );
}
