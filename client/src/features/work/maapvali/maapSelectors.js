import { addDaysISO } from "../../../utils/formatDate";

/** period: "ALL" | "TODAY" | "WEEK" (today and the 6 days before). search: worker name, ID or note. */
export const filterMaapEntries = (entries, { search = "", period = "ALL", today }) => {
  const q = search.trim().toLowerCase();
  const weekStart = addDaysISO(today, -6);

  return entries.filter((e) => {
    if (period === "TODAY" && e.date !== today) return false;
    if (period === "WEEK" && e.date < weekStart) return false;
    if (!q) return true;
    return (
      e.workerName.toLowerCase().includes(q) || e.labourId.toLowerCase().includes(q) || (e.note ?? "").toLowerCase().includes(q)
    );
  });
};
