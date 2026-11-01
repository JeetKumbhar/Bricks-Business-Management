// Pure helpers for rate history (no database), so attendance, maap and production phases can price work by date.
// `historyAsc` is a list of { effectiveFrom: "YYYY-MM-DD", ratePaise } sorted oldest first.

export const sortRatesAsc = (rows = []) => [...rows].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));

/**
 * The rate in force on `date`: the latest entry that starts on or before it.
 * A date before the first entry uses the first rate (same as the frontend), so an early record is never priced at zero.
 * Returns null only when there is no history at all.
 */
export const ratePaiseAt = (historyAsc, date) => {
  if (!historyAsc?.length) return null;
  let current = historyAsc[0].ratePaise;
  for (const entry of historyAsc) {
    if (entry.effectiveFrom <= date) current = entry.ratePaise;
    else break;
  }
  return current;
};
