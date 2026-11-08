// Bill numbers follow the backend (server/utils/billRules.js). A DRAFT has NO number. The number is allocated only when the
// bill is finalized, from a counter per prefix + financial year. In this mock phase the counter is derived from the bills the
// browser knows about; once the API is connected the server's number is the only one that counts.

/** Indian financial year of a business date: 2026-11-04 -> "2026-27", 2027-02-10 -> "2026-27" */
export const financialYear = (isoDate) => {
  const year = Number(isoDate.slice(0, 4));
  const month = Number(isoDate.slice(5, 7));
  const start = month >= 4 ? year : year - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
};

export const DEFAULT_NUMBERING = { prefix: "AC", separator: "/", includeFinancialYear: true, padding: 4 };

/** Prefix / separator / financial year / padded running number joined like the backend: "AC/2026-27/0001" */
export const formatBillNumber = ({ numbering, financialYear: fy, seq }) => {
  const sep = numbering.separator ?? "";
  const parts = [numbering.prefix || null, numbering.includeFinancialYear ? fy : null, String(seq).padStart(numbering.padding ?? 4, "0")].filter(Boolean);
  return parts.join(sep);
};

/** Identifies one number series (same as the backend counter id). A new financial year starts a new series. */
export const counterIdFor = ({ numbering, financialYear: fy }) => `bill:${numbering.prefix ?? ""}:${numbering.includeFinancialYear ? fy : "all"}`;

/** Number and series for the next bill finalized on `billDate`. Cancelled bills keep their numbers, so they are counted too. */
export const allocateBillNumber = (bills, numbering, billDate) => {
  const fy = financialYear(billDate);
  const series = counterIdFor({ numbering, financialYear: fy });
  const top = bills.reduce((max, b) => (b.numberSeries === series ? Math.max(max, b.sequence ?? 0) : max), 0);
  const sequence = top + 1;
  return { billNumber: formatBillNumber({ numbering, financialYear: fy, seq: sequence }), numberSeries: series, sequence, financialYear: fy };
};
