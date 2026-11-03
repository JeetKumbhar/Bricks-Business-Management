// Minimal PDF writer with no dependencies: a title, filter lines and one table (A4 landscape, repeating header row,
// wrapped cells, page numbers). Uses the standard Helvetica fonts, so only Latin letters are drawn:
// characters outside Latin-1 (for example Devanagari) become "?". Use the Excel export for such text.
import { downloadBlob } from "./downloadFile";

const PAGE = { w: 842, h: 595, margin: 36, bottom: 44 };

// Helvetica glyph widths (1000 units per em) for ASCII 32..126.
const W = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];

/** Keep Latin-1 only; everything else becomes "?". */
export const toLatin1 = (value) =>
  String(value ?? "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[^\x20-\x7e\xa0-\xff]/g, "?");

export const textWidth = (text, size, bold = false) => {
  let w = 0;
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    w += code >= 32 && code <= 126 ? W[code - 32] : 556;
  }
  return (w / 1000) * size * (bold ? 1.06 : 1);
};

/** Break text into lines that fit `maxWidth`. Long words are split. */
export const wrapText = (text, maxWidth, size, bold = false) => {
  const clean = toLatin1(text).trim();
  if (!clean) return [""];
  const lines = [];
  let line = "";
  for (const word of clean.split(" ")) {
    let w = word;
    while (textWidth(w, size, bold) > maxWidth && w.length > 1) {
      let cut = w.length - 1;
      while (cut > 1 && textWidth(w.slice(0, cut), size, bold) > maxWidth) cut -= 1;
      if (line) {
        lines.push(line);
        line = "";
      }
      lines.push(w.slice(0, cut));
      w = w.slice(cut);
    }
    const candidate = line ? `${line} ${w}` : w;
    if (textWidth(candidate, size, bold) <= maxWidth) line = candidate;
    else {
      lines.push(line);
      line = w;
    }
  }
  if (line) lines.push(line);
  return lines;
};

const pdfString = (s) => `(${toLatin1(s).replace(/[\\()]/g, (c) => `\\${c}`)})`;
const num = (n) => (Math.round(n * 100) / 100).toString();

/**
 * Build the PDF bytes.
 * { title, metaLines: [text], headers: [text], rows: [[text]], kinds?: [data|section|subtotal|total],
 *   weights: [relative widths], align?: ["left" | "right"] }
 * `rows` are already formatted text. section rows span the full width; subtotal / total rows right-align their
 * label (taken from the last column that has text before the numbers) across the first columns.
 */
export const buildPdf = ({ title, metaLines = [], headers, rows, kinds = [], weights, align = [], labelColumn = 4 }) => {
  const usable = PAGE.w - PAGE.margin * 2;
  const total = weights.reduce((a, b) => a + b, 0);
  const widths = weights.map((w) => (w / total) * usable);
  const xs = widths.reduce((acc, w, i) => [...acc, acc[i] + w], [PAGE.margin]);
  const FS = 8.5;
  const LH = 11;
  const PAD = 3;

  const pages = [];
  let ops = [];
  let y = PAGE.h - PAGE.margin;

  const text = (s, x, yy, { size = FS, bold = false } = {}) => ops.push(`BT /${bold ? "F2" : "F1"} ${size} Tf ${num(x)} ${num(yy)} Td ${pdfString(s)} Tj ET`);
  const fill = (x, yy, w, h, gray) => ops.push(`${gray} g ${num(x)} ${num(yy)} ${num(w)} ${num(h)} re f 0 g`);
  const hline = (yy, gray = 0.85) => ops.push(`${gray} G 0.5 w ${num(PAGE.margin)} ${num(yy)} m ${num(PAGE.w - PAGE.margin)} ${num(yy)} l S 0 G`);
  const newPage = () => {
    pages.push(ops);
    ops = [];
    y = PAGE.h - PAGE.margin;
  };

  // title + filter lines (first page only)
  if (title) {
    text(title, PAGE.margin, y - 14, { size: 15, bold: true });
    y -= 24;
  }
  for (const line of metaLines) {
    text(line, PAGE.margin, y - 9, { size: 9 });
    y -= 12;
  }
  if (title || metaLines.length) y -= 6;

  const drawHeader = () => {
    const h = LH + PAD * 2;
    fill(PAGE.margin, y - h, usable, h, 0.8);
    headers.forEach((head, i) => {
      const right = align[i] === "right";
      const x = right ? xs[i + 1] - PAD - textWidth(toLatin1(head), FS, true) : xs[i] + PAD;
      text(head, x, y - PAD - 8, { bold: true });
    });
    y -= h;
  };
  drawHeader();

  rows.forEach((cells, index) => {
    const kind = kinds[index] ?? "data";
    const bold = kind !== "data";
    let lines;
    let layout;

    if (kind === "section") {
      lines = wrapText(cells[0], usable - PAD * 2, FS, true);
      layout = "section";
    } else if (kind === "subtotal" || kind === "total") {
      layout = "total";
      lines = wrapText(cells[labelColumn], xs[labelColumn + 1] - xs[0] - PAD * 2, FS, true);
    } else {
      layout = "data";
      lines = cells.map((c, i) => wrapText(c, widths[i] - PAD * 2, FS, false));
    }
    const lineCount = layout === "data" ? Math.max(...lines.map((l) => l.length)) : lines.length;
    const h = lineCount * LH + PAD * 2;

    if (y - h < PAGE.bottom) {
      newPage();
      drawHeader();
    }

    if (kind === "section") fill(PAGE.margin, y - h, usable, h, 0.93);
    if (kind === "total") fill(PAGE.margin, y - h, usable, h, 0.86);

    if (layout === "section") {
      lines.forEach((l, k) => text(l, PAGE.margin + PAD, y - PAD - 8 - k * LH, { bold: true }));
    } else if (layout === "total") {
      const right = xs[labelColumn + 1] - PAD;
      lines.forEach((l, k) => text(l, right - textWidth(l, FS, true), y - PAD - 8 - k * LH, { bold: true }));
      for (let i = labelColumn + 1; i < cells.length; i += 1) {
        const s = toLatin1(cells[i]);
        if (!s) continue;
        const x = align[i] === "right" ? xs[i + 1] - PAD - textWidth(s, FS, true) : xs[i] + PAD;
        text(s, x, y - PAD - 8, { bold: true });
      }
    } else {
      cells.forEach((_, i) => {
        lines[i].forEach((l, k) => {
          const x = align[i] === "right" ? xs[i + 1] - PAD - textWidth(l, FS) : xs[i] + PAD;
          text(l, x, y - PAD - 8 - k * LH, { bold });
        });
      });
    }
    y -= h;
    hline(y);
  });

  if (rows.length === 0) text("No Pheera found for these filters.", PAGE.margin + PAD, y - 16);
  pages.push(ops);

  // assemble: 1 catalog, 2 pages, 3 Helvetica, 4 Helvetica-Bold, then (page, content) pairs
  const objects = [];
  const pageIds = pages.map((_, i) => 5 + i * 2);
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`;
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
  objects[4] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>";
  pages.forEach((pageOps, i) => {
    const footer = `BT /F1 8 Tf ${num(PAGE.w - PAGE.margin - 60)} 24 Td ${pdfString(`Page ${i + 1} of ${pages.length}`)} Tj ET`;
    const stream = [...pageOps, footer].join("\n");
    objects[5 + i * 2] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE.w} ${PAGE.h}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${6 + i * 2} 0 R >>`;
    objects[6 + i * 2] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  });

  // every character is one byte (Latin-1), so string length = byte length
  let body = "%PDF-1.4\n";
  const offsets = [];
  for (let id = 1; id < objects.length; id += 1) {
    offsets[id] = body.length;
    body += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xref = body.length;
  body += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id += 1) body += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;

  const out = new Uint8Array(body.length);
  for (let i = 0; i < body.length; i += 1) out[i] = body.charCodeAt(i) & 0xff;
  return out;
};

export const downloadPdf = (filename, options) => downloadBlob(filename, buildPdf(options), "application/pdf");
