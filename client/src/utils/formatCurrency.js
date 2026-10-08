const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

/** 342800 -> "₹3,42,800"  (Indian digit grouping). Negative values keep the minus sign. */
export const formatCurrency = (value) => inr.format(Number(value) || 0);

/** 342800 -> "3,42,800" (no symbol). */
export const formatNumber = (value) => new Intl.NumberFormat("en-IN").format(Number(value) || 0);
