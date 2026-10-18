// Date ranges for Salary and Reports. There is no fixed salary week, so any range can be chosen.
import { addDaysISO, formatDate } from "./formatDate";

const dayOfWeek = (iso) => new Date(`${iso}T00:00:00Z`).getUTCDay(); // 0 = Sunday

/** Monday of the week containing `iso`. ("This week" is Monday to today; the business has no fixed week.) */
export const startOfWeek = (iso) => addDaysISO(iso, -((dayOfWeek(iso) + 6) % 7));
export const startOfMonth = (iso) => `${iso.slice(0, 7)}-01`;

// Season start / end dates are still to be confirmed with the client, so "Season to date" simply means all records.
export const ALL_TIME_START = "0000-01-01";

export const PERIOD_PRESETS = [
  { id: "LAST7", label: "Last 7 days" },
  { id: "WEEK", label: "This week" },
  { id: "MONTH", label: "This month" },
  { id: "SEASON", label: "Season to date" },
  { id: "CUSTOM", label: "Custom" },
];

/** -> { start, end, label, error?, isSeason } */
export const resolvePeriod = ({ preset, custom, today }) => {
  switch (preset) {
    case "WEEK":
      return { start: startOfWeek(today), end: today, isSeason: false, label: `${formatDate(startOfWeek(today))} - ${formatDate(today)}` };
    case "MONTH":
      return { start: startOfMonth(today), end: today, isSeason: false, label: `${formatDate(startOfMonth(today))} - ${formatDate(today)}` };
    case "SEASON":
      return { start: ALL_TIME_START, end: today, isSeason: true, label: "Season to date (all records)" };
    case "CUSTOM": {
      const start = custom?.start || today;
      const end = custom?.end || today;
      if (end < start) {
        return { start, end: start, isSeason: false, label: formatDate(start), error: "The end date is before the start date." };
      }
      return { start, end, isSeason: false, label: `${formatDate(start)} - ${formatDate(end)}` };
    }
    default: {
      const start = addDaysISO(today, -6);
      return { start, end: today, isSeason: false, label: `${formatDate(start)} - ${formatDate(today)}` };
    }
  }
};
