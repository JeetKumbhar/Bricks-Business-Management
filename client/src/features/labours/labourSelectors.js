import { toISODate } from "../../utils/formatDate";
import { LABOUR_STATUS } from "../../utils/labourStatus";
import { LABOUR_TYPES } from "../../utils/labourTypes";

export const isJoinedThisMonth = (joiningDate, today = new Date()) =>
  Boolean(joiningDate) && joiningDate.slice(0, 7) === toISODate(today).slice(0, 7);

/** total = every salary account (individual workers + Patlavale teams). */
export const getLabourCounts = (labours) => ({
  total: labours.length,
  active: labours.filter((l) => l.status === LABOUR_STATUS.ACTIVE).length,
  inactive: labours.filter((l) => l.status === LABOUR_STATUS.INACTIVE).length,
  newThisMonth: labours.filter((l) => isJoinedThisMonth(l.joiningDate)).length,
  bigari: labours.filter((l) => l.labourType === LABOUR_TYPES.BIGARI).length,
  maapvali: labours.filter((l) => l.labourType === LABOUR_TYPES.MAAPVALI).length,
  patlavale: labours.filter((l) => l.labourType === LABOUR_TYPES.PATLAVALE).length,
});

/**
 * status: "ALL" | "ACTIVE" | "INACTIVE" | "NEW" (joined this month)
 * type:   "ALL" | "BIGARI" | "MAAPVALI" | "PATLAVALE"
 * search: matches name (team name for Patlavale), mobile number or labour ID
 */
export const filterLabours = (labours, { search = "", status = "ALL", type = "ALL" } = {}) => {
  const q = search.trim().toLowerCase();

  return labours.filter((l) => {
    if (type !== "ALL" && l.labourType !== type) return false;

    if (status === "NEW") {
      if (!isJoinedThisMonth(l.joiningDate)) return false;
    } else if (status !== "ALL" && l.status !== status) {
      return false;
    }

    if (!q) return true;
    return l.name.toLowerCase().includes(q) || l.mobile.includes(q) || l.id.toLowerCase().includes(q);
  });
};
