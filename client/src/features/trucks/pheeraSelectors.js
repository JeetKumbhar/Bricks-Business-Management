// Read-side helpers for Pheera: decorate, filter, sort, total, group, paginate. Pure functions.
// Bricks and tonnes are always totalled separately.
import { STANDARD_MATERIALS, UNITS } from "../../utils/materials";
import { activePheeras } from "./pheeraOps";

/** Hundredths as integers, so 0.1 + 0.2 style rounding errors never show up in tonnes. */
const addTonnes = (a, b) => Math.round(a * 100 + b * 100) / 100;

/** Active records plus the truck's CURRENT registration number (falls back to the saved snapshot). */
export const decoratePheeras = (records, trucks, { voided = false } = {}) => {
  const byId = Object.fromEntries(trucks.map((t) => [t.id, t]));
  return (voided ? records.filter((r) => r.isDeleted || r.isVoided) : activePheeras(records)).map((r) => ({
    ...r,
    registration: byId[r.truckId]?.truckNumber ?? r.truckRegistration,
    truckNickname: byId[r.truckId]?.nickname ?? "",
  }));
};

/** { count, bricks, tonnes, brickCount, tonneCount } - never mixes units. */
export const summarizePheeras = (rows) => {
  const out = { count: rows.length, bricks: 0, tonnes: 0, brickCount: 0, tonneCount: 0 };
  for (const r of rows) {
    if (r.unit === UNITS.BRICKS) {
      out.bricks += r.quantity;
      out.brickCount += 1;
    } else {
      out.tonnes = addTonnes(out.tonnes, r.quantity);
      out.tonneCount += 1;
    }
  }
  return out;
};

const has = (text, q) => String(text ?? "").toLowerCase().includes(q);

/**
 * filters: { date, from, to, truckId, search, material, destination }
 * `date` (one day) wins over from/to. `search` matches registration, nickname, material, destination or remarks. `material` matches the saved name exactly (ignoring capitals).
 */
export const filterPheeras = (rows, f = {}) => {
  const q = String(f.search ?? "").trim().toLowerCase();
  const dest = String(f.destination ?? "").trim().toLowerCase();
  return rows.filter((r) => {
    if (f.date) {
      if (r.businessDate !== f.date) return false;
    } else {
      if (f.from && r.businessDate < f.from) return false;
      if (f.to && r.businessDate > f.to) return false;
    }
    if (f.truckId && r.truckId !== f.truckId) return false;
    if (f.material && r.material.toLowerCase() !== String(f.material).toLowerCase()) return false;
    if (dest && !has(r.destination, dest)) return false;
    if (q && !(has(r.registration, q) || has(r.truckRegistration, q) || has(r.material, q) || has(r.truckNickname, q) || has(r.destination, q) || has(r.remarks, q))) return false;
    return true;
  });
};

/** newest: date desc, then truck, then Pheera number. oldest: date asc. */
export const sortPheeras = (rows, order = "newest") => {
  const dir = order === "oldest" ? 1 : -1;
  return [...rows].sort(
    (a, b) =>
      dir * a.businessDate.localeCompare(b.businessDate) ||
      a.registration.localeCompare(b.registration) ||
      a.pheeraNumber - b.pheeraNumber
  );
};

/** -> [{ key, rows, summary }] in the order the keys first appear (sort the rows first). */
export const groupPheeras = (rows, keyOf) => {
  const map = new Map();
  for (const r of rows) {
    const k = keyOf(r);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(r);
  }
  return [...map].map(([key, list]) => ({ key, rows: list, summary: summarizePheeras(list) }));
};

/** One line per date, newest first: [{ date, summary }] */
export const dailySummaries = (rows) =>
  groupPheeras(sortPheeras(rows, "newest"), (r) => r.businessDate).map((g) => ({ date: g.key, summary: g.summary }));

export const paginate = (rows, page, pageSize) => {
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const current = Math.min(Math.max(1, page), pageCount);
  return { items: rows.slice((current - 1) * pageSize, current * pageSize), page: current, pageCount, total: rows.length };
};

/** Material names saved so far that are not in the standard list (typed names and older records), most used first. */
export const knownMaterials = (rows) => {
  const counts = new Map();
  for (const r of rows) if (!STANDARD_MATERIALS.includes(r.material)) counts.set(r.material, (counts.get(r.material) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name]) => name);
};

/** What the material FILTER lists: the standard materials, then every other name found in the data. */
export const materialFilterOptions = (rows) => [...STANDARD_MATERIALS, ...knownMaterials(rows)];

/** Destinations used before, most used first (for the suggestion list). */
export const knownDestinations = (rows) => {
  const counts = new Map();
  for (const r of rows) counts.set(r.destination, (counts.get(r.destination) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name]) => name);
};
