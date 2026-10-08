import { toISODate } from "../../utils/formatDate";
import { LABOUR_STATUS } from "../../utils/labourStatus";

export const isJoinedThisMonth = (joiningDate, today = new Date()) =>
  Boolean(joiningDate) && joiningDate.slice(0, 7) === toISODate(today).slice(0, 7);

export const getLabourCounts = (labours) => ({
  total: labours.length,
  active: labours.filter((l) => l.status === LABOUR_STATUS.ACTIVE).length,
  inactive: labours.filter((l) => l.status === LABOUR_STATUS.INACTIVE).length,
  newThisMonth: labours.filter((l) => isJoinedThisMonth(l.joiningDate)).length,
});

/**
 * status: "ALL" | "ACTIVE" | "INACTIVE" | "NEW" (joined this month)
 * search: matches name, mobile number or labour ID
 */
export const filterLabours = (labours, { search = "", status = "ALL" }) => {
  const q = search.trim().toLowerCase();

  return labours.filter((l) => {
    if (status === "NEW") {
      if (!isJoinedThisMonth(l.joiningDate)) return false;
    } else if (status !== "ALL" && l.status !== status) {
      return false;
    }

    if (!q) return true;
    return l.name.toLowerCase().includes(q) || l.mobile.includes(q) || l.id.toLowerCase().includes(q);
  });
};
