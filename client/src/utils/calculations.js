/** sumBy(items, "amount") or sumBy(items, (item) => item.a + item.b) */
export const sumBy = (items = [], key) =>
  items.reduce((total, item) => total + (typeof key === "function" ? key(item) : Number(item[key]) || 0), 0);

/** percentage(42, 48) -> 88  (0 when total is 0) */
export const percentage = (part, total) => (total ? Math.round((part / total) * 100) : 0);

// ---- Labour salary maths (see docs/BUSINESS_RULES.md) ----
// PRESENT = 1 day, HALF_DAY = 0.5 day, ABSENT = 0

/** Payable days: presentDays + 0.5 x halfDays */
export const attendanceDays = ({ presentDays = 0, halfDays = 0 }) => presentDays + halfDays * 0.5;

/** earned = days x dailyRate */
export const calculateEarned = (labour) => attendanceDays(labour) * (labour.dailyRate || 0);

/** balance = earned - received. Negative means overpaid (shown in red). */
export const calculateBalance = (labour) => calculateEarned(labour) - (labour.totalReceived || 0);
