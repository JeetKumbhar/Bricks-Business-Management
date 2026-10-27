import { formatNumber } from "../../utils/formatCurrency";
import { LABOUR_TYPES } from "../../utils/labourTypes";

/** One line describing the work done in the range, for each type. */
export const workLine = (row) => {
  const w = row.period.work;
  if (row.labourType === LABOUR_TYPES.MAAPVALI) return { primary: `${formatNumber(w.maaps)} maaps`, secondary: `${w.workDays} work days` };
  if (row.labourType === LABOUR_TYPES.PATLAVALE) {
    return {
      primary: `${formatNumber(w.payableBricks)} payable bricks`,
      secondary: `${formatNumber(w.maaps)} maaps, ${formatNumber(w.physicalBricks)} physical`,
    };
  }
  return { primary: `${w.workingUnits} days`, secondary: `${w.presentDays} full, ${w.halfDays} half, ${w.absentDays} absent` };
};
