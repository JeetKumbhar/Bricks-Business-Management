// Download a truck report as CSV, Excel or PDF. All three come from the same report model as the on-screen preview.
import { downloadCsv } from "../../utils/exportCsv";
import { downloadXlsx } from "../../utils/exportXlsx";
import { downloadPdf } from "../../utils/exportPdf";
import { formatQuantity } from "../../utils/materials";
import { reportFileName, reportMetaLines, reportToMatrix } from "./truckReports";

export const EXPORT_FORMATS = [
  { id: "csv", label: "CSV" },
  { id: "xlsx", label: "Excel" },
  { id: "pdf", label: "PDF" },
];

const COLUMN_WEIGHTS = [62, 70, 52, 70, 170, 70, 50, 226];
const COLUMN_ALIGN = ["left", "left", "right", "left", "left", "right", "left", "left"];
const XLSX_WIDTHS = [13, 12, 11, 12, 32, 12, 10, 40];

/** Quantity as text for the PDF ("1,500"), using each row's own unit. */
const displayRows = (matrix) =>
  matrix.rows.map((cells) => cells.map((c, i) => (i === 5 && typeof c === "number" ? formatQuantity(c, cells[6]) : String(c ?? ""))));

/** Build the downloadable file. `model` must be a report without `error`. */
export function exportReport(model, format) {
  const meta = reportMetaLines(model);

  if (format === "csv") {
    const matrix = reportToMatrix(model, { safe: true });
    // title and filter lines first, one per row, then a blank row, then the table
    downloadCsv(reportFileName(model, "csv"), [meta[0]], [...meta.slice(1).map((l) => [l]), [], matrix.headers, ...matrix.rows]);
    return;
  }

  const matrix = reportToMatrix(model);
  if (format === "xlsx") {
    downloadXlsx(reportFileName(model, "xlsx"), {
      sheetName: "Truck Report",
      title: meta[0],
      metaLines: meta.slice(1),
      headers: matrix.headers,
      rows: matrix.rows,
      kinds: matrix.kinds,
      colWidths: XLSX_WIDTHS,
    });
    return;
  }

  downloadPdf(reportFileName(model, "pdf"), {
    title: meta[0],
    metaLines: meta.slice(1),
    headers: matrix.headers,
    rows: displayRows(matrix),
    kinds: matrix.kinds,
    weights: COLUMN_WEIGHTS,
    align: COLUMN_ALIGN,
  });
}

export { displayRows };
