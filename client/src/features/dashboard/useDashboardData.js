import { useMemo } from "react";
import { dashboardData } from "../../mock/dashboard";
import { sumBy } from "../../utils/calculations";

/**
 * Single place the Dashboard gets its data.
 * Later: replace the mock with an API call (services/api.js) and add real loading / error state.
 */
export default function useDashboardData() {
  return useMemo(() => {
    const weeklyPaymentsTotal = sumBy(
      dashboardData.weeklyPayments,
      (p) => p.bookingAdvance + p.salaryPayment + p.other
    );
    return { ...dashboardData, weeklyPaymentsTotal, isLoading: false };
  }, []);
}
