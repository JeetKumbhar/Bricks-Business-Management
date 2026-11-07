// Pure Pheera totals (no database). Every Pheera is one trip. Bricks and tonnes are NEVER added together: every total has a
// separate `bricks` and `tonnes` figure. Tonnes are summed as whole kilograms, so there is no floating-point drift.
// Voided records are never passed in: totals come only from live records.
import { UNITS } from "../constants/truck.js";
import { fromMilli, toMilli } from "../utils/truckRules.js";

/** { trips, bricks, tonnes } for a list of trip rows ({ quantity, unit }). */
export const summarizeTrips = (rows = []) => ({
  trips: rows.length,
  bricks: rows.filter((r) => r.unit === UNITS.BRICKS).reduce((t, r) => t + r.quantity, 0),
  tonnes: fromMilli(rows.filter((r) => r.unit === UNITS.TONNES).reduce((t, r) => t + toMilli(r.quantity), 0)),
});

/**
 * Group rows and total each group. keyOf(row) -> key; labelOf(row) -> label (taken from the first row of the group).
 * Groups are sorted by label. Each group also carries `unit` and `quantity` when all its rows share one unit (a material
 * always does), so a material-wise line can show "2.5 tonnes" or "3,000 bricks" without mixing.
 */
export const groupTrips = (rows, keyOf, labelOf, extra = () => ({})) => {
  const map = new Map();
  for (const row of rows) {
    const key = keyOf(row);
    if (!map.has(key)) map.set(key, { key, label: labelOf(row), ...extra(row), rows: [] });
    map.get(key).rows.push(row);
  }
  return [...map.values()]
    .sort((a, b) => String(a.label).localeCompare(String(b.label)) || String(a.key).localeCompare(String(b.key)))
    .map(({ rows: groupRows, ...group }) => {
      const totals = summarizeTrips(groupRows);
      const units = [...new Set(groupRows.map((r) => r.unit))];
      return { ...group, ...totals, unit: units.length === 1 ? units[0] : null, quantity: units.length === 1 ? (units[0] === UNITS.BRICKS ? totals.bricks : totals.tonnes) : null };
    });
};
