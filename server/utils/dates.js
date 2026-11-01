// Business dates. A "business date" is a CALENDAR DAY in the business timezone, written "YYYY-MM-DD", e.g. the day the
// attendance was marked or the maaps were carried. It is stored and compared as that plain string, never as a JS Date,
// so it cannot shift by a day when a server or browser in another timezone converts it.
//
// Audit/event times (createdAt, deletedAt, ...) are real instants and are stored as UTC Dates.
//
// Business timezone: Asia/Kolkata (IST, UTC+05:30). [APPROVED 1 Nov 2026]
// India has no daylight saving, so the fixed offset below is always correct for this timezone.
export const BUSINESS_TIME_ZONE = "Asia/Kolkata";
export const BUSINESS_UTC_OFFSET = "+05:30";

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 24 * 60 * 60 * 1000;

/** True for a real calendar date in "YYYY-MM-DD" form ("2026-02-30" is not). */
export const isValidBusinessDate = (value) => {
  if (typeof value !== "string") return false;
  const match = DATE_PATTERN.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const check = new Date(Date.UTC(year, month - 1, day));
  return check.getUTCFullYear() === year && check.getUTCMonth() === month - 1 && check.getUTCDate() === day;
};

const assertDate = (value) => {
  if (!isValidBusinessDate(value)) throw new RangeError(`Invalid business date: ${JSON.stringify(value)} (use YYYY-MM-DD)`);
  return value;
};

const formatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: BUSINESS_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** The business date an instant falls on, e.g. 2026-10-31T20:00:00Z is already 2026-11-01 in India. */
export const toBusinessDate = (instant = new Date()) => formatter.format(instant);

export const todayBusinessDate = (now = new Date()) => toBusinessDate(now);

/** True when the date is after today in the business timezone (no future entries). */
export const isFutureBusinessDate = (date, now = new Date()) => assertDate(date) > todayBusinessDate(now);

/** Calendar arithmetic on a business date: addDays("2026-02-28", 1) === "2026-03-01". */
export const addDays = (date, days) => {
  assertDate(date);
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day) + days * DAY_MS).toISOString().slice(0, 10);
};

/** Number of days from `from` to `to` (to - from). */
export const diffDays = (from, to) => {
  const ms = (d) => {
    const [year, month, day] = assertDate(d).split("-").map(Number);
    return Date.UTC(year, month - 1, day);
  };
  return Math.round((ms(to) - ms(from)) / DAY_MS);
};

/**
 * The UTC instants that bound one business day: [start, endExclusive).
 * Use it to query real timestamps (createdAt, ...) for "everything that happened on this business date".
 */
export const businessDayToUtcRange = (date) => {
  assertDate(date);
  return {
    start: new Date(`${date}T00:00:00.000${BUSINESS_UTC_OFFSET}`),
    endExclusive: new Date(`${addDays(date, 1)}T00:00:00.000${BUSINESS_UTC_OFFSET}`),
  };
};

/** Inclusive date range -> UTC bounds, for queries over timestamps. */
export const businessRangeToUtcRange = (startDate, endDate) => {
  if (assertDate(startDate) > assertDate(endDate)) throw new RangeError(`Range start ${startDate} is after end ${endDate}`);
  return { start: businessDayToUtcRange(startDate).start, endExclusive: businessDayToUtcRange(endDate).endExclusive };
};
