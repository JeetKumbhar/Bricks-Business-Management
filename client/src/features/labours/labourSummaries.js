import { attendanceDays } from "../../utils/calculations";
import { formatNumber } from "../../utils/formatCurrency";
import { LABOUR_TYPES } from "../../utils/labourTypes";

/** What to show in the "Work" column / card line for each type. */
export const getWorkSummary = (worker) => {
  if (worker.labourType === LABOUR_TYPES.MAAPVALI) {
    return { primary: `${formatNumber(worker.totalMaaps)} maaps`, secondary: `${worker.workDays} work days` };
  }
  if (worker.labourType === LABOUR_TYPES.PATLAVALE) {
    return {
      primary: `${formatNumber(worker.totalPayableBricks)} payable bricks`,
      secondary: `${formatNumber(worker.totalPhysicalBricks)} physical, ${formatNumber(worker.carryForwardBricks)} carry`,
    };
  }
  return {
    primary: `${attendanceDays(worker)} days`,
    secondary: `${worker.presentDays} full, ${worker.halfDays} half`,
  };
};
