import { useMemo } from "react";
import { dashboardData as staticData } from "../../mock/dashboard";
import { toISODate } from "../../utils/formatDate";
import useLabours from "../labours/useLabours";
import { buildDashboardData } from "./dashboardSelectors";

/**
 * Single place the Dashboard gets its data.
 * Everything about labour, attendance, maap work, production and payments is calculated from the same records
 * the other pages use. Only owner details and trucks come from mock/dashboard.js (no Trucks module yet).
 * Later: replace with an API call (services/api.js) and add real loading / error state.
 */
export default function useDashboardData() {
  const { allLabours, getAttendanceByDate, getAttendance, allMaapEntries, allProductionEntries, allPayments } = useLabours();
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
      isLoading: false,
    }),
    [allLabours, getAttendanceByDate, getAttendance, allMaapEntries, allProductionEntries, allPayments, today]
  );
}
