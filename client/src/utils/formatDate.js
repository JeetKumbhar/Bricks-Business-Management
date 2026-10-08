// Dates are stored in UTC and always displayed in IST (see docs/BUSINESS_RULES.md).
const TZ = "Asia/Kolkata";

const toDate = (value) => (value instanceof Date ? value : new Date(value));
const pad = (n) => String(n).padStart(2, "0");

/** Local date -> "YYYY-MM-DD" (format used by DatePicker and the API). */
export const toISODate = (date = new Date()) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

/** "08 Oct 2026" */
export const formatDate = (value) =>
  new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: TZ }).format(
    toDate(value)
  );

/** "Thursday, 8 October 2026" */
export const formatLongDate = (value) =>
  new Intl.DateTimeFormat("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: TZ,
  }).format(toDate(value));

/** "Thu" */
export const formatShortWeekday = (value) =>
  new Intl.DateTimeFormat("en-IN", { weekday: "short", timeZone: TZ }).format(toDate(value));

/** "2 hours ago", "yesterday", "just now" */
export const formatRelativeTime = (value, now = Date.now()) => {
  const seconds = Math.round((toDate(value).getTime() - now) / 1000);
  const abs = Math.abs(seconds);
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

  if (abs < 60) return "just now";
  if (abs < 3600) return rtf.format(Math.round(seconds / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(seconds / 3600), "hour");
  return rtf.format(Math.round(seconds / 86400), "day");
};

/** "Good Morning" / "Good Afternoon" / "Good Evening" (IST hour). */
export const getGreeting = (value = new Date()) => {
  const hour =
    Number(new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hour12: false, timeZone: TZ }).format(toDate(value))) %
    24;
  if (hour < 12) return "Good Morning";
  if (hour < 17) return "Good Afternoon";
  return "Good Evening";
};
