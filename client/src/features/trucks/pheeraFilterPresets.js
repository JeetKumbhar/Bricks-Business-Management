// Quick date ranges for Pheera filters. All dates are IST business dates ("YYYY-MM-DD").
import { addDaysISO } from "../../utils/formatDate";
import { startOfMonth } from "../../utils/dateRanges";

export const DATE_PRESETS = [
  { id: "TODAY", label: "Today" },
  { id: "YESTERDAY", label: "Yesterday" },
  { id: "LAST7", label: "Last 7 days" },
  { id: "MONTH", label: "This month" },
  { id: "ALL", label: "All dates" },
];

/** -> { from, to } ("" means no limit) */
export const presetRange = (id, today) => {
  switch (id) {
    case "TODAY":
      return { from: today, to: today };
    case "YESTERDAY":
      return { from: addDaysISO(today, -1), to: addDaysISO(today, -1) };
    case "MONTH":
      return { from: startOfMonth(today), to: today };
    case "ALL":
      return { from: "", to: "" };
    default:
      return { from: addDaysISO(today, -6), to: today };
  }
};

/** Which preset the current from / to equals (or "" for a custom range). */
export const detectPreset = (from, to, today) =>
  DATE_PRESETS.find((p) => {
    const r = presetRange(p.id, today);
    return r.from === from && r.to === to;
  })?.id ?? "";

export const emptyFilters = (today) => ({ ...presetRange("LAST7", today), truckId: "", material: "", destination: "", search: "" });
