// Money helpers for invoices. Amounts are kept as whole PAISE (integers) so there is never a floating point error.
// Typed numbers are read as decimal TEXT (never through parseFloat) and scaled to integers.

/** Read "12", "12.5", ".5" as an integer scaled by 10^decimals. -> { ok, scaled } | { ok: false, reason } */
export const parseScaled = (raw, decimals) => {
  const text = String(raw ?? "").trim();
  if (!text) return { ok: false, reason: "empty" };
  if (!/^(\d+\.?\d*|\.\d+)$/.test(text)) return { ok: false, reason: "format" };
  const [whole = "0", frac = ""] = text.split(".");
  if (frac.length > decimals) return { ok: false, reason: "decimals" };
  return { ok: true, scaled: Number(whole || "0") * 10 ** decimals + Number(frac.padEnd(decimals, "0") || "0") };
};

/** Integer division rounded half up (for non-negative numbers). BigInt keeps big products exact. */
export const roundDiv = (numerator, denominator) => {
  const n = BigInt(numerator);
  const d = BigInt(denominator);
  return Number((n * 2n + d) / (d * 2n));
};

const groupIndian = (digits) => {
  if (digits.length <= 3) return digits;
  const last3 = digits.slice(-3);
  const rest = digits.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",");
  return `${rest},${last3}`;
};

/** 12345050 paise -> "1,23,450.50" (Indian grouping, always 2 decimals) */
export const formatINR = (paise) => {
  const p = Math.round(Number(paise) || 0);
  const sign = p < 0 ? "-" : "";
  const abs = Math.abs(p);
  return `${sign}${groupIndian(String(Math.floor(abs / 100)))}.${String(abs % 100).padStart(2, "0")}`;
};

/** With the rupee sign, for the app screens. */
export const formatRupees = (paise) => `\u20B9${formatINR(paise)}`;

/** The invoice has separate Rs. and P. columns: 12345050 -> { rs: "1,23,450", p: "50" } */
export const splitRsP = (paise) => {
  const abs = Math.abs(Math.round(Number(paise) || 0));
  return { rs: groupIndian(String(Math.floor(abs / 100))), p: String(abs % 100).padStart(2, "0") };
};

/** Plain number text without useless zeros: 2.50 -> "2.5", 9 -> "9" */
export const trimNumber = (n) => String(Number(n));
