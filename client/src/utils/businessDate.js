// Business dates are plain "YYYY-MM-DD" strings read as India Standard Time (IST, UTC+05:30).
// They are never turned into Date objects that could shift the day. Audit timestamps (createdAt) stay UTC ISO strings.

const IST = "Asia/Kolkata";
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Today's business date in IST, whatever the browser's time zone is. */
export const todayBusinessDate = (now = new Date()) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: IST, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);

/** True for a real calendar date written as YYYY-MM-DD (rejects 2026-02-30). */
export const isBusinessDate = (value) => {
  const m = ISO_DATE.exec(String(value ?? ""));
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const probe = new Date(Date.UTC(y, mo - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === mo - 1 && probe.getUTCDate() === d;
};

/** 0 = Sunday ... 6 = Saturday (pure date maths, no time zone drift). */
export const weekdayOf = (iso) => new Date(`${iso}T00:00:00Z`).getUTCDay();
