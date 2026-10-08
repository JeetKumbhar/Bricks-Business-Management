/** sumBy(items, "amount") or sumBy(items, (item) => item.a + item.b) */
export const sumBy = (items = [], key) =>
  items.reduce((total, item) => total + (typeof key === "function" ? key(item) : Number(item[key]) || 0), 0);

/** percentage(42, 48) -> 88  (0 when total is 0) */
export const percentage = (part, total) => (total ? Math.round((part / total) * 100) : 0);
