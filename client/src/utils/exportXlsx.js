// Minimal Excel (.xlsx) writer with no dependencies: one sheet, text + numbers, a few styles.
// An .xlsx file is a ZIP of XML files; the ZIP here is "stored" (no compression), which every reader accepts.
import { downloadBlob } from "./downloadFile";

const encoder = new TextEncoder();

// ---------- ZIP (stored) ----------
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export const crc32 = (bytes) => {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

/** files: [{ name, data: string | Uint8Array }] -> Uint8Array (a .zip) */
export const buildZip = (files) => {
  const parts = [];
  const central = [];
  let offset = 0;
  const u16 = (n) => [n & 0xff, (n >>> 8) & 0xff];
  const u32 = (n) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];

  for (const file of files) {
    const name = encoder.encode(file.name);
    const data = typeof file.data === "string" ? encoder.encode(file.data) : file.data;
    const crc = crc32(data);
    // 0x0021 = 1980-01-01, time 0. UTF-8 names (flag bit 11).
    const common = [...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x0021), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(name.length), ...u16(0)];
    parts.push(new Uint8Array([0x50, 0x4b, 0x03, 0x04, ...common]), name, data);
    central.push({ name, header: [0x50, 0x4b, 0x01, 0x02, ...u16(20), ...common, ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset)] });
    offset += 30 + name.length + data.length;
  }

  let centralSize = 0;
  for (const c of central) {
    parts.push(new Uint8Array(c.header), c.name);
    centralSize += c.header.length + c.name.length;
  }
  parts.push(new Uint8Array([0x50, 0x4b, 0x05, 0x06, ...u16(0), ...u16(0), ...u16(central.length), ...u16(central.length), ...u32(centralSize), ...u32(offset), ...u16(0)]));

  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let pos = 0;
  for (const p of parts) {
    out.set(p, pos);
    pos += p.length;
  }
  return out;
};

// ---------- Sheet XML ----------
// eslint-disable-next-line no-control-regex
const XML_BAD = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g;
const esc = (s) => String(s).replace(XML_BAD, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const colName = (index) => {
  let n = index + 1;
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
};

// style ids (see STYLES below)
const STYLE = { normal: 0, title: 1, header: 2, section: 3, subtotal: 4, total: 5 };
const KIND_STYLE = { data: STYLE.normal, section: STYLE.section, subtotal: STYLE.subtotal, total: STYLE.total };

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="14"/><name val="Calibri"/></font></fonts>
<fills count="5"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFD9D9D9"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFEEF3FA"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFFFF2CC"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="6">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
<xf numFmtId="0" fontId="1" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="1" fillId="4" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

const cell = (ref, value, style) => {
  if (value === null || value === undefined || value === "") return style ? `<c r="${ref}" s="${style}"/>` : "";
  if (typeof value === "number" && Number.isFinite(value)) return `<c r="${ref}" s="${style}"><v>${value}</v></c>`;
  return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${esc(value)}</t></is></c>`;
};

/**
 * Build the .xlsx bytes.
 * { sheetName, title, metaLines: [text], headers: [text], rows: [[cell]], kinds?: [data|section|subtotal|total], colWidths?: [number] }
 * Numbers stay numbers (so Excel can sum them); everything else is text (never run as a formula).
 */
export const buildXlsx = ({ sheetName = "Report", title, metaLines = [], headers, rows, kinds = [], colWidths = [] }) => {
  const xmlRows = [];
  let r = 1;
  if (title) xmlRows.push(`<row r="${r++}">${cell(`A1`, title, STYLE.title)}</row>`);
  for (const line of metaLines) {
    xmlRows.push(`<row r="${r}">${cell(`A${r}`, line, STYLE.normal)}</row>`);
    r += 1;
  }
  if (title || metaLines.length) r += 1; // blank line
  const headerRow = r;
  xmlRows.push(`<row r="${r}">${headers.map((h, c) => cell(`${colName(c)}${r}`, h, STYLE.header)).join("")}</row>`);
  r += 1;
  rows.forEach((cells, i) => {
    const style = KIND_STYLE[kinds[i] ?? "data"];
    xmlRows.push(`<row r="${r}">${cells.map((v, c) => cell(`${colName(c)}${r}`, v, style)).join("")}</row>`);
    r += 1;
  });

  const widths = headers.map((h, c) => colWidths[c] ?? Math.min(48, Math.max(10, String(h).length + 4)));
  const cols = `<cols>${widths.map((w, c) => `<col min="${c + 1}" max="${c + 1}" width="${w}" customWidth="1"/>`).join("")}</cols>`;
  const view = `<sheetViews><sheetView workbookViewId="0"><pane ySplit="${headerRow}" topLeftCell="A${headerRow + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`;
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${view}${cols}<sheetData>${xmlRows.join("")}</sheetData></worksheet>`;

  // Excel sheet names: max 31 chars, none of  : \ / ? * [ ]
  const safeName = esc(String(sheetName).replace(/[:\\/?*[\]]/g, " ").slice(0, 31) || "Report");

  return buildZip([
    { name: "[Content_Types].xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>` },
    { name: "_rels/.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: "xl/workbook.xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${safeName}" sheetId="1" r:id="rId1"/></sheets></workbook>` },
    { name: "xl/_rels/workbook.xml.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: "xl/styles.xml", data: STYLES },
    { name: "xl/worksheets/sheet1.xml", data: sheet },
  ]);
};

export const downloadXlsx = (filename, options) =>
  downloadBlob(filename, buildXlsx(options), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
