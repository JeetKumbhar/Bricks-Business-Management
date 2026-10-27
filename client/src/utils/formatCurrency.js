const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

const inrPaise = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * 342800 -> "₹3,42,800"  (Indian digit grouping). Negative values keep the minus sign.
 * An amount that really has paise is shown in full (2562.5 -> "₹2,562.50"), so a paid maap is never rounded away.
 */
export const formatCurrency = (value) => {
  const n = Number(value) || 0;
  return Math.abs(n - Math.round(n)) > 0.004 ? inrPaise.format(n) : inr.format(n);
};

/** 342800 -> "3,42,800" (no symbol). */
export const formatNumber = (value) => new Intl.NumberFormat("en-IN").format(Number(value) || 0);
