// Truck reports: one model that the on-screen preview AND the CSV / Excel / PDF exports all use,
// so what you see is exactly what you download. Every report lists the individual Pheera,
// with subtotals per group and grand totals. Bricks and tonnes are totalled separately.
import { formatDate } from "../../utils/formatDate";
import { todayBusinessDate } from "../../utils/businessDate";
import { UNITS } from "../../utils/materials";
import { filterPheeras, groupPheeras, sortPheeras, summarizePheeras } from "./pheeraSelectors";

export const REPORT_TYPES = [
  { id: "truck", label: "Truck-wise history", needs: "truck + range", group: "date" },
  { id: "daily", label: "Daily transportation", needs: "date", group: "truck" },
  { id: "range", label: "Date range", needs: "range", group: "date" },
  { id: "material", label: "Material-wise", needs: "range", group: "material" },
  { id: "destination", label: "Destination-wise", needs: "range", group: "destination" },
  { id: "all", label: "All trucks combined", needs: "range", group: "truck" },
];

export const REPORT_COLUMNS = [
  { key: "date", header: "Date" },
  { key: "truck", header: "Truck" },
  { key: "number", header: "Pheera No.", align: "right" },
  { key: "material", header: "Material" },
  { key: "destination", header: "Destination" },
  { key: "quantity", header: "Quantity", align: "right" },
  { key: "unit", header: "Unit" },
  { key: "remarks", header: "Remarks" },
];

const GROUP_KEY = {
  date: (r) => r.businessDate,
  truck: (r) => r.registration,
  material: (r) => r.material,
  destination: (r) => r.destination,
};

const GROUP_LABEL = {
  date: (k) => formatDate(k),
  truck: (k) => `Truck ${k}`,
  material: (k) => `Material: ${k}`,
  destination: (k) => `Destination: ${k}`,
};

/** [{ unit, count, quantity }] for the units that are present. Bricks first. Never mixes the two. */
export const unitTotals = (summary) => {
  const out = [];
  if (summary.brickCount > 0) out.push({ unit: UNITS.BRICKS, count: summary.brickCount, quantity: summary.bricks });
  if (summary.tonneCount > 0) out.push({ unit: UNITS.TONNES, count: summary.tonneCount, quantity: summary.tonnes });
  return out;
};

/**
 * params: { type, date, from, to, truckId, material, destination }
 * rows: decorated Pheera (see decoratePheeras). trucks: for the filter text.
 * -> { error } or { title, type, filterLines, columns, sections, grand, count }
 */
export const buildReport = ({ rows, params, trucks = [], generatedOn = todayBusinessDate() }) => {
  const def = REPORT_TYPES.find((t) => t.id === params.type);
  if (!def) return { error: "Choose a report" };

  const single = params.type === "daily";
  if (single && !params.date) return { error: "Choose the date for the daily report" };
  if (!single) {
    if (!params.from || !params.to) return { error: "Choose the start and end dates" };
    if (params.to < params.from) return { error: "The end date is before the start date" };
  }
  if (params.type === "truck" && !params.truckId) return { error: "Choose a truck for the truck-wise report" };

  const filtered = filterPheeras(rows, {
    date: single ? params.date : "",
    from: single ? "" : params.from,
    to: single ? "" : params.to,
    truckId: params.truckId,
    material: params.material,
    destination: params.destination,
  });
  const sorted = sortPheeras(filtered, "oldest");
  const sections = groupPheeras(sorted, GROUP_KEY[def.group]).map((g) => ({
    heading: GROUP_LABEL[def.group](g.key),
    rows: g.rows,
    summary: g.summary,
    totals: unitTotals(g.summary),
  }));
  const grandSummary = summarizePheeras(sorted);
  const truck = trucks.find((t) => t.id === params.truckId);

  return {
    type: params.type,
    title: `Truck Report - ${def.label}`,
    filterLines: [
      single ? `Date: ${formatDate(params.date)}` : `Date range: ${formatDate(params.from)} to ${formatDate(params.to)}`,
      `Truck: ${truck ? truck.truckNumber : "All trucks"}`,
      `Material: ${params.material || "All materials"}`,
      `Destination: ${String(params.destination ?? "").trim() || "All destinations"}`,
      `Generated on: ${formatDate(generatedOn)} (IST)`,
    ],
    columns: REPORT_COLUMNS,
    sections,
    grand: { summary: grandSummary, totals: unitTotals(grandSummary) },
    count: sorted.length,
  };
};

/** A spreadsheet cell that starts with = + - @ could run as a formula in Excel. Make it plain text. */
export const csvSafe = (value) => (typeof value === "string" && /^[=+\-@\t\r]/.test(value) ? `'${value}` : value);

/**
 * Flat table for CSV / Excel / PDF.
 * -> { headers, rows: [cells], kinds: ["section" | "data" | "subtotal" | "total"] }
 * Quantities stay numbers; units are in their own column.
 */
export const reportToMatrix = (model, { safe = false } = {}) => {
  const s = safe ? csvSafe : (v) => v;
  const rows = [];
  const kinds = [];
  const push = (kind, cells) => {
    rows.push(cells);
    kinds.push(kind);
  };
  const totalRows = (kind, label, totals) => {
    totals.forEach((t) => push(kind, ["", "", "", "", `${label} - ${t.count} Pheera (${t.unit})`, t.quantity, t.unit, ""]));
  };

  for (const section of model.sections) {
    push("section", [section.heading, "", "", "", "", "", "", ""]);
    for (const r of section.rows) {
      push("data", [r.businessDate, s(r.registration), r.pheeraNumber, s(r.material), s(r.destination), r.quantity, r.unit, s(r.remarks)]);
    }
    totalRows("subtotal", "Subtotal", section.totals);
  }
  totalRows("total", "GRAND TOTAL", model.grand.totals);
  return { headers: model.columns.map((c) => c.header), rows, kinds };
};

/** Lines above the table in an export: title, filters, total Pheera. */
export const reportMetaLines = (model) => [model.title, ...model.filterLines, `Total Pheera: ${model.count}`];

export const reportFileName = (model, ext) => {
  const dates = model.filterLines[0].replace(/^Date range: |^Date: /, "").replace(/ to /, "_to_");
  const slug = `${model.type}-${dates}`.toLowerCase().replace(/[^a-z0-9_]+/g, "-").replace(/^-|-$/g, "");
  return `truck-report-${slug}.${ext}`;
};
