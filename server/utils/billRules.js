import { GSTIN_PATTERN, MAX_QUANTITY_DECIMALS } from "../constants/bill.js";

// Exact conversions for invoice inputs. A JSON number is turned into text first, so 0.1 + 0.2 style artefacts are rejected
// instead of rounded.
const decimalText = (value, decimals) => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  const match = new RegExp(`^(\\d+)(?:\\.(\\d{1,${decimals}}))?$`).exec(String(value));
  return match ? { whole: match[1], fraction: (match[2] ?? "").padEnd(decimals, "0") } : null;
};
const scaled = (value, decimals) => {
  const parts = decimalText(value, decimals);
  if (!parts) return null;
  const n = Number(parts.whole + parts.fraction);
  return Number.isSafeInteger(n) ? n : null;
};

/** 2.5 -> 2500 milli-units (at most 3 decimals), or null when it is not a clean non-negative number. */
export const parseMilli = (quantity) => scaled(quantity, MAX_QUANTITY_DECIMALS);
/** 5 -> 500 basis points, 2.5 -> 250 (at most 2 decimals). */
export const parseBp = (percent) => scaled(percent, 2);
/** 12.5 rupees -> 1250 paise (at most 2 decimals). */
export const parseRupeesToPaise = (rupees) => scaled(rupees, 2);

export const milliToNumber = (milli) => milli / 1000;
export const bpToPercent = (bp) => (bp === null || bp === undefined ? null : bp / 100);

/** Indian financial year (April to March) of a business date: "2026-11-07" -> "2026-27". */
export const financialYearOf = (businessDate) => {
  const year = Number(businessDate.slice(0, 4));
  const start = Number(businessDate.slice(5, 7)) >= 4 ? year : year - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
};

/** A GSTIN starts with its state's 2-digit code, so the two must agree when both are given. */
export const gstinMatchesState = (gstin, stateCode) => !gstin || !stateCode || !GSTIN_PATTERN.test(gstin) || gstin.slice(0, 2) === stateCode;

export const formatBillNumber = ({ numbering, financialYear, seq }) => {
  const sep = numbering.separator ?? "";
  const parts = [numbering.prefix || null, numbering.includeFinancialYear ? financialYear : null, String(seq).padStart(numbering.padding ?? 4, "0")].filter(Boolean);
  return parts.join(sep);
};
export const counterIdFor = ({ numbering, financialYear }) => `bill:${numbering.prefix ?? ""}:${numbering.includeFinancialYear ? financialYear : "all"}`;
