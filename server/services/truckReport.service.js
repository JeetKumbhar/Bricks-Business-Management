import Truck from "../models/Truck.js";
import TruckTrip from "../models/TruckTrip.js";
import ApiError from "../utils/ApiError.js";
import { groupTrips, summarizeTrips } from "./truckTripCalculations.js";
import { buildTripFilter, toTripDto } from "./truckTrip.service.js";
import { toTruckDto } from "./truck.service.js";

// Truck reports. READ ONLY, and built from the SAME live Pheera records and the SAME totals code as the history, so every report
// agrees. Rules:
//  - Every Pheera is one trip and is listed individually in `records`; groups only add subtotals.
//  - Every total has separate `bricks` and `tonnes` figures. Bricks and tonnes are never added together. A material-wise line
//    shows its own `quantity` in its own `unit`; each custom material (e.g. Stone Dust) has its own line.
//  - Voided records are never included. Filtering by date uses the business date exactly (inclusive), nothing outside it.
//  - The response is export-ready: `columns` name the record columns, `filters` echoes what was applied, `records` are the individual
//    rows (truck registration, date, Pheera number, material name, destination, quantity, unit) and `groups` / `totals` the subtotals.
//    The server returns data; Excel / PDF / CSV files are produced from it by the frontend.

export const RECORD_COLUMNS = Object.freeze([
  { key: "businessDate", label: "Date" },
  { key: "truckNumber", label: "Truck" },
  { key: "pheeraNo", label: "Pheera" },
  { key: "materialName", label: "Material" },
  { key: "destination", label: "Destination" },
  { key: "quantity", label: "Quantity" },
  { key: "unit", label: "Unit" },
  { key: "remarks", label: "Remarks" },
]);
export const GROUP_COLUMNS = Object.freeze([
  { key: "label", label: "Group" },
  { key: "trips", label: "Pheera" },
  { key: "bricks", label: "Bricks" },
  { key: "tonnes", label: "Tonnes" },
]);

const chronological = (a, b) => a.businessDate.localeCompare(b.businessDate) || a.truckNumber.localeCompare(b.truckNumber) || a.pheeraNo - b.pheeraNo;
const FILTER_KEYS = ["truckId", "registration", "material", "materialName", "destination", "date", "from", "to"];
const echo = (filters) => Object.fromEntries(FILTER_KEYS.filter((k) => filters[k] !== undefined).map((k) => [k, filters[k]]));

const load = async (filters) => (await TruckTrip.find(buildTripFilter({ ...filters, includeVoided: false })).lean()).sort(chronological);

const byTruck = (rows) => groupTrips(rows, (r) => String(r.truckId), (r) => r.truckNumber);
const byMaterial = (rows) => groupTrips(rows, (r) => r.materialKey, (r) => r.materialName, (r) => ({ category: r.materialCategory }));
const byDestination = (rows) => groupTrips(rows, (r) => r.destinationKey, (r) => r.destination);
const byDate = (rows) => groupTrips(rows, (r) => r.businessDate, (r) => r.businessDate);

const envelope = (report, title, filters, rows, groups, breakdowns = {}, extra = {}) => ({
  report,
  title,
  filters: echo(filters),
  columns: RECORD_COLUMNS,
  groupColumns: GROUP_COLUMNS,
  totals: summarizeTrips(rows),
  groups,
  breakdowns,
  records: rows.map(toTripDto),
  ...extra,
});

/** 1. One truck's history: every Pheera it made, by day, with material and destination breakdowns. */
export const truckReport = async (truckId, filters) => {
  const [truck] = await Truck.find({ _id: truckId }).lean();
  if (!truck) throw ApiError.notFound("Truck not found");
  const rows = await load({ ...filters, truckId });
  return envelope("TRUCK", `Truck report: ${truck.truckNumber}`, { ...filters, truckId }, rows, byDate(rows), { materials: byMaterial(rows), destinations: byDestination(rows) }, { truck: toTruckDto(truck) });
};

/** 2. One day, by truck. */
export const dailyReport = async (filters) => {
  const rows = await load(filters);
  return envelope("DAILY", `Daily transportation report: ${filters.date}`, filters, rows, byTruck(rows), { materials: byMaterial(rows) });
};

/** 3. A date range, by day. */
export const rangeReport = async (filters) => {
  const rows = await load(filters);
  return envelope("RANGE", `Transportation report: ${filters.from} to ${filters.to}`, filters, rows, byDate(rows), { trucks: byTruck(rows), materials: byMaterial(rows) });
};

/** 4. Material-wise: each material (Bricks, Soil, every custom material) on its own line in its own unit. */
export const materialReport = async (filters) => {
  const rows = await load(filters);
  return envelope("MATERIAL", "Material-wise report", filters, rows, byMaterial(rows), { trucks: byTruck(rows) });
};

/** 5. Destination-wise. */
export const destinationReport = async (filters) => {
  const rows = await load(filters);
  return envelope("DESTINATION", "Destination-wise report", filters, rows, byDestination(rows), { materials: byMaterial(rows) });
};

/** 6. All trucks combined: one line per truck (trucks with no Pheera in the period show zero) and the fleet total. */
export const allTrucksReport = async (filters) => {
  const rows = await load(filters);
  const groups = byTruck(rows);
  if (!filters.truckId && !filters.registration) {
    const seen = new Set(groups.map((g) => g.key));
    const idle = (await Truck.find({}).lean()).filter((t) => !seen.has(String(t._id))).map((t) => ({ key: String(t._id), label: t.truckNumber, trips: 0, bricks: 0, tonnes: 0, unit: null, quantity: null }));
    groups.push(...idle);
    groups.sort((a, b) => a.label.localeCompare(b.label));
  }
  return envelope("ALL_TRUCKS", "All trucks combined report", filters, rows, groups, { materials: byMaterial(rows), destinations: byDestination(rows) });
};
