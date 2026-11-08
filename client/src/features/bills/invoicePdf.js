// A4 portrait tax invoice as a real PDF (text, lines and colours - not a screenshot), built with no library.
// It mirrors the on-screen invoice: same pages (invoicePages.js), same columns and wording. Standard Helvetica fonts,
// so only Latin text can be drawn: other scripts (for example Devanagari) print as "?". The rupee sign is written "Rs."
import { downloadBlob } from "../../utils/downloadFile";
import { textWidth, toLatin1, wrapText } from "../../utils/exportPdf";
import { amountInWords } from "../../utils/amountInWords";
import { splitRsP } from "../../utils/money";
import { BILL_STATUS } from "./billModel";
import { billTotals } from "./billSelectors";
import { addressParts, billNumberText, INVOICE_COLUMNS, invoiceDate, invoiceSeller, phoneList, quantityText, rateText, taxRows } from "./invoiceFormat";
import { paginateItems, rowUnits } from "./invoicePages";

const W = 595;
const H = 842;
const M = 24;
const CW = W - M * 2;
const RED = [0.659, 0.075, 0.169];
const INK = [0.106, 0.106, 0.106];
const WHITE = [1, 1, 1];
const MARK = [0.97, 0.89, 0.9];
const UNIT = 15; // height of one text line of a row
const LINE = 11.5;
const n2 = (n) => (Math.round(n * 100) / 100).toString();

const fitText = (text, width, size, bold) => {
  let s = toLatin1(text);
  if (textWidth(s, size, bold) <= width) return s;
  while (s.length > 1 && textWidth(`${s}...`, size, bold) > width) s = s.slice(0, -1);
  return `${s}...`;
};

/** Tiny drawing surface: y is measured from the TOP of the page. */
class Surface {
  constructor() {
    this.ops = [];
  }
  color(c) {
    this.ops.push(`${c.map(n2).join(" ")} rg`);
  }
  text(str, x, y, { size = 9.5, font = "F1", color = RED, align = "left" } = {}) {
    const s = toLatin1(str);
    if (!s) return;
    const bold = font !== "F1";
    const w = textWidth(s, size, bold);
    const px = align === "right" ? x - w : align === "center" ? x - w / 2 : x;
    this.color(color);
    this.ops.push(`BT /${font} ${size} Tf ${n2(px)} ${n2(H - y)} Td (${s.replace(/[\\()]/g, (c) => `\\${c}`)}) Tj ET`);
    return w;
  }
  rotatedText(str, x, y, deg, { size, font, color }) {
    const s = toLatin1(str);
    const a = (deg * Math.PI) / 180;
    this.color(color);
    this.ops.push(`BT /${font} ${size} Tf ${n2(Math.cos(a))} ${n2(Math.sin(a))} ${n2(-Math.sin(a))} ${n2(Math.cos(a))} ${n2(x)} ${n2(H - y)} Tm (${s}) Tj ET`);
  }
  line(x1, y1, x2, y2, lw = 1, color = RED) {
    this.ops.push(`${color.map(n2).join(" ")} RG ${lw} w ${n2(x1)} ${n2(H - y1)} m ${n2(x2)} ${n2(H - y2)} l S`);
  }
  rect(x, y, w, h, { lw = 1, stroke = RED, fill = null } = {}) {
    if (fill) this.ops.push(`${fill.map(n2).join(" ")} rg ${n2(x)} ${n2(H - y - h)} ${n2(w)} ${n2(h)} re f`);
    if (stroke) this.ops.push(`${stroke.map(n2).join(" ")} RG ${lw} w ${n2(x)} ${n2(H - y - h)} ${n2(w)} ${n2(h)} re S`);
  }
}

function drawPage(bill, rows, startIndex, pageNumber, pageCount, totals) {
  const { customer } = bill;
  const { seller, bank } = invoiceSeller(bill);
  const last = pageNumber === pageCount;
  const s = new Surface();
  const bold = { font: "F2" };
  const status = bill.status;

  // DRAFT / CANCELLED mark first, so the content is drawn over it
  if (status === BILL_STATUS.DRAFT || status === BILL_STATUS.CANCELLED) {
    const word = status === BILL_STATUS.DRAFT ? "DRAFT" : "CANCELLED";
    const size = word === "DRAFT" ? 120 : 84;
    const wd = textWidth(word, size, true);
    const a = (28 * Math.PI) / 180;
    const [cx, cy] = [W / 2, H * 0.52];
    const [ox, oy] = [wd / 2, size * 0.35];
    s.rotatedText(word, cx - (ox * Math.cos(a) - oy * Math.sin(a)), cy + (ox * Math.sin(a) + oy * Math.cos(a)), 28, { size, font: "F2", color: MARK });
  }

  // ---- letterhead
  const phones = phoneList(seller.phones);
  const juris = seller.jurisdiction ? `Subject to ${seller.jurisdiction}` : "";
  const jw = s.text(juris, W / 2, 33, { size: 8.5, ...bold, align: "center" });
  s.line(W / 2 - jw / 2, 34.5, W / 2 + jw / 2, 34.5, 0.7);
  phones.slice(0, 3).forEach((p, i) => s.text(i === 0 ? `Mob. : ${p}` : p, W - M, 33 + i * 10, { size: 8.5, ...bold, align: "right" }));
  const tw = s.text("TAX INVOICE", W / 2, 47, { size: 10.5, ...bold, align: "center" });
  s.line(W / 2 - tw / 2, 48.5, W / 2 + tw / 2, 48.5, 0.8);
  const nameSize = Math.min(32, (CW * 32) / Math.max(textWidth(toLatin1(seller.name), 32, true), 1));
  s.text(seller.name, W / 2, 79, { size: nameSize, font: "F3", align: "center" });
  s.text(seller.description, W / 2, 98, { size: 12.5, ...bold, align: "center" });
  const pl = toLatin1(seller.productLine);
  s.text(pl, W / 2, 114, { size: Math.min(10.5, (CW * 10.5) / Math.max(textWidth(pl, 10.5, true), 1)), ...bold, align: "center" });
  const addr = addressParts(seller.address);
  const head = toLatin1(addr.head).toUpperCase();
  const rest = toLatin1(addr.rest);
  const total = textWidth(head, 11, true) + textWidth(rest, 9, false);
  const ax = W / 2 - total / 2;
  s.text(head, ax, 128, { size: 11, ...bold });
  s.text(rest, ax + textWidth(head, 11, true), 128, { size: 9 });
  s.line(M, 135, W - M, 135, 1.4);
  s.text(`GSTIN : ${seller.gstin}`, M + 2, 151, { size: 11, ...bold });
  s.text(`PAN No : ${seller.pan}`, W - M - 2, 151, { size: 11, ...bold, align: "right" });

  // ---- customer box + bill number / date
  const pTop = 158;
  const pH = 88;
  const leftW = Math.round(CW * 0.72);
  const rightW = CW - leftW;
  s.rect(M, pTop, leftW, pH, { lw: 1.1 });
  s.rect(M + leftW, pTop, rightW, pH / 2, { lw: 1.1 });
  s.rect(M + leftW, pTop + pH / 2, rightW, pH / 2, { lw: 1.1 });
  s.text("M/s.", M + 7, pTop + 19, { size: 11, ...bold });
  s.text(fitText(customer.name, leftW - 46, 11, true), M + 36, pTop + 19, { size: 11, ...bold, color: INK });
  s.line(M + 34, pTop + 22, M + leftW - 7, pTop + 22, 0.6);
  const addrLines = wrapText(customer.address || "", leftW - 16, 9.5, true).filter(Boolean);
  const shown = addrLines.slice(0, 2);
  if (addrLines.length > 2) shown[1] = fitText(`${shown[1]} ${addrLines[2]}`, leftW - 16, 9.5, true);
  shown.forEach((ln, i) => s.text(ln, M + 7, pTop + 40 + i * 17, { size: 9.5, ...bold, color: INK }));
  s.line(M + 7, pTop + 44, M + leftW - 7, pTop + 44, 0.6);
  s.line(M + 7, pTop + 61, M + leftW - 7, pTop + 61, 0.6);
  s.text("GSTIN :", M + 7, pTop + 80, { size: 10 });
  s.text(customer.gstin || "", M + 50, pTop + 79, { size: 10, ...bold, color: INK });
  s.line(M + 48, pTop + 82, M + 235, pTop + 82, 0.6);
  s.text("State Code :", M + 245, pTop + 80, { size: 10 });
  s.text(customer.stateCode || "", M + 305, pTop + 79, { size: 10, ...bold, color: INK });
  s.line(M + 303, pTop + 82, M + leftW - 7, pTop + 82, 0.6);
  s.text("Bill No. :", M + leftW + 9, pTop + 26, { size: 10 });
  s.text(billNumberText(bill), M + leftW + 55, pTop + 26, { size: 10, ...bold, color: INK });
  s.text("Bill Date :", M + leftW + 9, pTop + 70, { size: 10 });
  s.text(invoiceDate(bill.billDate), M + leftW + 58, pTop + 70, { size: 10, ...bold, color: INK });

  // ---- item table
  const tTop = pTop + pH - 1;
  const headH = 30;
  const bodyTop = tTop + headH;
  const footerH = 20 + 80 + 72;
  const bodyBottom = last ? H - M - footerH : H - M - 18;
  const xs = INVOICE_COLUMNS.reduce((acc, f) => [...acc, acc[acc.length - 1] + f * CW], [M]);
  const tableBottom = last ? bodyBottom + 20 : bodyBottom + 18;

  s.rect(M, tTop, CW, tableBottom - tTop, { lw: 1.1 });
  s.line(M, bodyTop, W - M, bodyTop, 1.1);
  for (let i = 1; i < 7; i += 1) {
    const x = xs[i];
    s.line(x, i === 6 ? tTop + headH / 2 : tTop, x, i < 5 ? (last ? bodyBottom : bodyBottom) : bodyBottom, 0.9);
  }
  s.line(xs[5], tTop + headH / 2, W - M, tTop + headH / 2, 0.9);
  const hdr = (label, i, y = tTop + 12, span = 1) => s.text(label, (xs[i] + xs[i + span]) / 2, y, { size: 8.5, ...bold, align: "center" });
  hdr("Sr.", 0, tTop + 12);
  hdr("No.", 0, tTop + 23);
  hdr("PARTICULARS", 1, tTop + 18);
  hdr("HSN/SAC", 2, tTop + 12);
  hdr("Code", 2, tTop + 23);
  hdr("Quantity", 3, tTop + 18);
  hdr("Rate", 4, tTop + 18);
  hdr("AMOUNT", 5, tTop + 11, 2);
  hdr("Rs.", 5, tTop + 25);
  hdr("P.", 6, tTop + 25);

  // ---- rows
  let y = bodyTop;
  rows.forEach((item, i) => {
    const units = rowUnits(item);
    const idx = startIndex + i;
    const amount = splitRsP(totals.lines[idx].amountPaise);
    const base = y + 10.5;
    const d = { size: 9, ...bold, color: INK };
    s.text(String(idx + 1), (xs[0] + xs[1]) / 2, base, { ...d, align: "center" });
    wrapText(item.particulars, xs[2] - xs[1] - 10, 9, true).forEach((ln, k) => s.text(ln, xs[1] + 5, base + k * LINE, d));
    s.text(item.hsn || "", (xs[2] + xs[3]) / 2, base, { ...d, align: "center" });
    wrapText(quantityText(item), xs[4] - xs[3] - 10, 9, true).forEach((ln, k) => s.text(ln, xs[4] - 5, base + k * LINE, { ...d, align: "right" }));
    s.text(rateText(item), xs[5] - 5, base, { ...d, align: "right" });
    s.text(amount.rs, xs[6] - 5, base, { ...d, align: "right" });
    s.text(amount.p, xs[7] - 5, base, { ...d, align: "right" });
    y += units * UNIT;
  });

  if (!last) {
    s.line(M, bodyBottom, W - M, bodyBottom, 1.1);
    s.text("Continued on next page...", W - M - 6, bodyBottom + 12.5, { size: 8.5, font: "F3", align: "right" });
  } else {
    // TOTAL row (only the Rate / Amount columns are boxed, like the bill book)
    s.line(M, bodyBottom, W - M, bodyBottom, 1.1);
    s.line(xs[4], bodyBottom, xs[4], bodyBottom + 20, 1.1);
    s.line(xs[5], bodyBottom, xs[5], bodyBottom + 20, 0.9);
    s.line(xs[6], bodyBottom, xs[6], bodyBottom + 20, 0.9);
    s.text("TOTAL", xs[4] + 5, bodyBottom + 14, { size: 9.5, ...bold });
    const t = splitRsP(totals.taxablePaise);
    s.text(t.rs, xs[6] - 5, bodyBottom + 14, { size: 9.5, ...bold, color: INK, align: "right" });
    s.text(t.p, xs[7] - 5, bodyBottom + 14, { size: 9.5, ...bold, color: INK, align: "right" });

    // bank details + tax rows
    const fTop = bodyBottom + 20;
    const bankX2 = xs[3];
    s.rect(M, fTop, bankX2 - M, 80, { lw: 1.1 });
    s.rect(M, fTop, 17, 80, { lw: 1.1, fill: RED, stroke: RED });
    s.rotatedText("BANK DETAILS", M + 12, fTop + 66, 90, { size: 7.5, font: "F2", color: WHITE });
    [["Bank Name", bank.name], ["Branch", bank.branch], ["Account No.", bank.accountNumber], ["IFSC Code", bank.ifsc]].forEach(([k, v], i) => {
      s.text(k, M + 27, fTop + 17 + i * 18, { size: 9.5, ...bold });
      s.text(`: ${v}`, M + 94, fTop + 17 + i * 18, { size: 9.5, ...bold, color: INK });
    });
    const taxes = taxRows(totals);
    const rowsOut = [...Array.from({ length: 3 - taxes.length }, () => null), ...taxes, { label: "GRAND TOTAL", paise: totals.grandPaise }];
    rowsOut.forEach((r, i) => {
      const ry = fTop + i * 20;
      s.rect(xs[3], ry, W - M - xs[3], 20, { lw: 1.1 });
      s.line(xs[5], ry, xs[5], ry + 20, 0.9);
      s.line(xs[6], ry, xs[6], ry + 20, 0.9);
      if (!r) return;
      const v = splitRsP(r.paise);
      s.text(r.label, xs[3] + 6, ry + 14, { size: 9.5, ...bold });
      s.text(v.rs, xs[6] - 5, ry + 14, { size: 9.5, ...bold, color: INK, align: "right" });
      s.text(v.p, xs[7] - 5, ry + 14, { size: 9.5, ...bold, color: INK, align: "right" });
    });

    // amount in words + signature
    const sTop = fTop + 80;
    const wordsW = Math.round(CW * 0.62);
    s.rect(M, sTop, wordsW, 72, { lw: 1.1 });
    s.rect(M + wordsW, sTop, CW - wordsW, 72, { lw: 1.1 });
    s.text("Amount in Words", M + 8, sTop + 16, { size: 10 });
    wrapText(amountInWords(totals.grandPaise), wordsW - 18, 9.5, true).slice(0, 3).forEach((ln, k) => s.text(ln, M + 8, sTop + 34 + k * 13, { size: 9.5, ...bold, color: INK }));
    s.line(M + 8, sTop + 63, M + wordsW - 8, sTop + 63, 0.6);
    const nameW = textWidth(toLatin1(seller.name), 10, true);
    s.text(seller.name, W - M - 8, sTop + 16, { size: 10, ...bold, align: "right" });
    s.text("For", W - M - 8 - nameW - 4, sTop + 16, { size: 10, align: "right" });
    s.text(seller.signatoryTitle, W - M - 8, sTop + 64, { size: 10, align: "right" });
  }
  if (pageCount > 1) s.text(`Page ${pageNumber} of ${pageCount}`, W - M, H - 10, { size: 7.5, ...bold, align: "right" });
  return s.ops.join("\n");
}

/** -> Uint8Array of the PDF for a bill: { billNumber, billDate, status, customer, items, taxMode, seller } */
export const buildInvoicePdf = (bill) => {
  const totals = billTotals(bill);
  const pages = paginateItems(bill.items);
  let start = 0;
  const streams = pages.map((rows, i) => {
    const content = drawPage(bill, rows, start, i + 1, pages.length, totals);
    start += rows.length;
    return content;
  });

  const objects = [];
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Kids [${streams.map((_, i) => `${6 + i * 2} 0 R`).join(" ")}] /Count ${streams.length} >>`;
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
  objects[4] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>";
  objects[5] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-BoldOblique /Encoding /WinAnsiEncoding >>";
  streams.forEach((stream, i) => {
    objects[6 + i * 2] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R >> >> /Contents ${7 + i * 2} 0 R >>`;
    objects[7 + i * 2] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  });

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

export const invoiceFileName = (bill) => `Tax-Invoice-${(bill.billNumber ?? "Draft").replace(/[^A-Za-z0-9]+/g, "-")}.pdf`;

export const downloadInvoicePdf = (bill) => downloadBlob(invoiceFileName(bill), buildInvoicePdf(bill), "application/pdf");
