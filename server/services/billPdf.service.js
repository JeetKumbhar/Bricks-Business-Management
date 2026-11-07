import PDFDocument from "pdfkit";
import { BILL_STATUS, TAX_MODE, TAX_TYPE } from "../constants/bill.js";
import { taxByRate } from "./billCalculations.js";

// A4 tax invoice laid out like a printed bill book: header block, M/s + bill number box, a ruled items table with separate
// Rs. and Ps. columns, totals, amount in words, bank details and the proprietor's signature area.
//  - Items are never split across pages: each row's height is measured first and the row moves to the next page if it will not fit.
//  - The table header repeats on every page; the totals + footer block stays together (moves to a fresh page if it will not fit).
//  - Built-in Helvetica is used, so text is Latin only (names in other scripts print as "?") and the rupee sign is written "Rs.".
const W = 595.28;
const H = 841.89;
const M = 28;
const CW = W - 2 * M;
const LIMIT = H - M - 22; // lowest y a row may reach; the rest is the page-number line
const COLS = [
  { key: "sr", label: "Sr.\nNo.", w: 28, align: "center" },
  { key: "particulars", label: "PARTICULARS", w: 203, align: "left" },
  { key: "hsn", label: "HSN/SAC\nCode", w: 56, align: "center" },
  { key: "qty", label: "QUANTITY", w: 82, align: "right" },
  { key: "rate", label: "RATE", w: 62, align: "right" },
  { key: "rs", label: "AMOUNT\nRs.", w: 72, align: "right" },
  { key: "ps", label: "\nPs.", w: 36, align: "center" },
];
const colX = (index) => M + COLS.slice(0, index).reduce((a, c) => a + c.w, 0);
const INK = "#111111";
const LINE = 0.7;

const safe = (text) => String(text ?? "").replace(/[^\x20-\x7E -ÿ\n]/g, "?");
const grouped = (n) => new Intl.NumberFormat("en-IN").format(n);
export const formatRupeesPart = (paise) => grouped(Math.floor(paise / 100));
export const formatPaisePart = (paise) => String(paise % 100).padStart(2, "0");
export const formatMoney = (paise) => `${formatRupeesPart(paise)}.${formatPaisePart(paise)}`;
export const formatQuantity = (milli, unit) => `${new Intl.NumberFormat("en-IN", { maximumFractionDigits: 3 }).format(milli / 1000)} ${unit}`.trim();
const formatDate = (d) => (d ? `${d.slice(8, 10)}-${d.slice(5, 7)}-${d.slice(0, 4)}` : "");
const percent = (bp) => `${bp / 100}%`;

export const renderInvoicePdf = (bill, { compress = true } = {}) =>
  new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margins: { top: M, left: M, right: M, bottom: 0 }, bufferPages: true, compress, info: { Title: `Invoice ${bill.billNumber ?? ""}`, Author: safe(bill.seller?.businessName ?? "") } });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    try {
      draw(doc, bill);
      doc.end();
    } catch (err) {
      reject(err);
    }
  });

const text = (doc, value, x, y, options = {}) => doc.text(safe(value), x, y, { lineBreak: options.width !== undefined, ...options });

const RED = "#B3122B"; // the printed ink of the bill book
const DATA = "#12203F"; // what is "filled in"

function draw(doc, bill) {
  const seller = bill.seller ?? {};
  const gst = bill.taxMode === TAX_MODE.GST;
  const c = bill.customer ?? {};
  const ink = (color, font = "Helvetica", size = 9.5) => doc.fillColor(color).font(font).fontSize(size);
  const box = (x, y, w, h) => doc.rect(x, y, w, h).stroke();
  doc.lineWidth(LINE).strokeColor(RED);
  let y = M;

  // ---- header (as printed on the bill book) ----------------------------------------------------------------------------------
  ink(RED, "Helvetica-Bold", 8.5);
  if (seller.jurisdiction) text(doc, `Subject to ${seller.jurisdiction} Jurisdiction`, M, y, { width: CW, align: "center", underline: true });
  if (seller.phones?.length) text(doc, `Mob.: ${seller.phones.join("\n")}`, M + CW - 120, y, { width: 120, align: "right" });
  y += 13;
  ink(RED, "Helvetica-Bold", 11);
  text(doc, gst ? "TAX INVOICE" : "INVOICE", M, y, { width: CW, align: "center", underline: true });
  y += 16;
  ink(RED, "Helvetica-Bold", 28);
  text(doc, seller.businessName, M, y, { width: CW, align: "center" });
  y += 34;
  for (const [line, font, size] of [[seller.businessDescription, "Helvetica-Bold", 11], [seller.productsLine, "Helvetica-Bold", 10], [seller.address, "Helvetica-Bold", 9]]) {
    if (!line) continue;
    ink(RED, font, size);
    text(doc, line, M + 8, y, { width: CW - 16, align: "center" });
    y += doc.heightOfString(safe(line), { width: CW - 16 }) + 2;
  }
  y += 4;
  doc.moveTo(M, y).lineTo(M + CW, y).lineWidth(1.2).stroke().lineWidth(LINE);
  y += 6;
  ink(RED, "Helvetica-Bold", 11);
  text(doc, seller.gstin ? `GSTIN : ${seller.gstin}` : "", M + 6, y, { width: CW / 2 });
  text(doc, seller.pan ? `PAN No : ${seller.pan}` : "", M + CW / 2, y, { width: CW / 2 - 6, align: "right" });
  y += 20;

  // ---- M/s box, Bill No. and Bill Date --------------------------------------------------------------------------------------------
  const boxTop = y;
  const leftW = CW - 150;
  let cy = boxTop + 8;
  ink(RED, "Helvetica-Bold", 10);
  text(doc, "M/s.", M + 6, cy, { width: 30 });
  ink(DATA, "Helvetica-Bold", 10.5);
  text(doc, c.name, M + 38, cy, { width: leftW - 46 });
  cy += Math.max(doc.heightOfString(safe(c.name), { width: leftW - 46 }), 12) + 4;
  ink(DATA, "Helvetica", 9.5);
  text(doc, c.address, M + 38, cy, { width: leftW - 46 });
  cy += Math.max(doc.heightOfString(safe(c.address), { width: leftW - 46 }), 24) + 6;
  const boxBottom = Math.max(cy + 24, boxTop + 96);
  const lastLine = boxBottom - 20;
  ink(RED, "Helvetica-Bold", 10);
  text(doc, "GSTIN :", M + 6, lastLine, { width: 50 });
  ink(DATA, "Helvetica", 10);
  text(doc, c.gstin, M + 58, lastLine, { width: leftW - 190 });
  ink(RED, "Helvetica-Bold", 10);
  text(doc, "State Code :", M + leftW - 125, lastLine, { width: 62 });
  ink(DATA, "Helvetica", 10);
  text(doc, c.stateCode, M + leftW - 60, lastLine, { width: 56 });
  box(M, boxTop, leftW, boxBottom - boxTop);
  const half = (boxBottom - boxTop) / 2;
  [["Bill No. :", bill.billNumber ?? ""], ["Bill Date :", formatDate(bill.billDate)]].forEach(([label, value], i) => {
    const top = boxTop + i * half;
    box(M + leftW, top, CW - leftW, half);
    ink(RED, "Helvetica-Bold", 9.5);
    text(doc, label, M + leftW + 6, top + half / 2 - 5, { width: 60, lineBreak: false });
    ink(DATA, "Helvetica-Bold", 10);
    text(doc, value, M + leftW + 66, top + half / 2 - 5, { width: CW - leftW - 70, lineBreak: false });
  });
  y = boxBottom;

  // ---- items table -------------------------------------------------------------------------------------------------------------
  let bodyTop;
  const tableHeader = () => {
    box(M, y, CW, 30);
    COLS.slice(1).forEach((_, i) => i !== 5 && doc.moveTo(colX(i + 1), y).lineTo(colX(i + 1), y + 30).stroke());
    ink(RED, "Helvetica", 8.5);
    ["Sr.\nNo.", "PARTICULARS", "HSN/SAC\nCode", "Quantity", "Rate"].forEach((label, i) => {
      const lines = label.split("\n").length;
      text(doc, label, colX(i) + 1, y + (lines === 2 ? 4 : 11), { width: COLS[i].w - 2, align: "center", lineGap: 1 });
    });
    text(doc, "AMOUNT", colX(5), y + 3, { width: COLS[5].w + COLS[6].w, align: "center" });
    text(doc, "Rs.", colX(5) + 4, y + 16, { width: COLS[5].w - 8, align: "left" });
    text(doc, "P.", colX(6), y + 16, { width: COLS[6].w, align: "center" });
    y += 30;
    bodyTop = y;
  };
  const closeBody = (bottom) => {
    COLS.slice(1).forEach((_, i) => doc.moveTo(colX(i + 1), bodyTop).lineTo(colX(i + 1), bottom).stroke());
    box(M, bodyTop, CW, bottom - bodyTop);
  };
  const blockHeight = footerHeight(bill);
  tableHeader();
  const rowH = (value) => Math.max(doc.font("Helvetica").fontSize(9.5).heightOfString(safe(value), { width: COLS[1].w - 8 }), 12) + 8;
  const place = (height) => {
    if (y + height <= LIMIT) return;
    closeBody(y);
    doc.addPage();
    y = M;
    doc.lineWidth(LINE).strokeColor(RED);
    tableHeader();
  };
  bill.items.forEach((item, index) => {
    const h = rowH(item.particulars);
    place(h);
    ink(DATA, "Helvetica", 9.5);
    const cells = { sr: String(index + 1), particulars: item.particulars, hsn: item.hsn, qty: formatQuantity(item.quantityMilli, item.unit), rate: formatMoney(item.ratePaise), rs: formatRupeesPart(item.taxablePaise), ps: formatPaisePart(item.taxablePaise) };
    COLS.forEach((col, i) => text(doc, cells[col.key], colX(i) + 4, y + 4, { width: col.w - 8, align: col.align }));
    y += h;
  });
  if (bill.notes) {
    const h = rowH(`Note: ${bill.notes}`);
    place(h);
    ink(DATA, "Helvetica-Oblique", 9);
    text(doc, `Note: ${bill.notes}`, colX(1) + 4, y + 4, { width: COLS[1].w - 8 });
    y += h;
  }
  // The body is ruled down to the TOTAL row like the printed book, so a short bill still looks like a filled form.
  const onFirstPage = doc.bufferedPageRange().count === 1;
  place(blockHeight);
  const bodyBottom = onFirstPage && doc.bufferedPageRange().count === 1 ? Math.max(y, LIMIT - blockHeight) : y;
  y = bodyBottom;
  closeBody(y);

  // ---- TOTAL row ---------------------------------------------------------------------------------------------------------------
  const amountCells = (paise, top, height) => {
    box(colX(5), top, COLS[5].w + COLS[6].w, height);
    doc.moveTo(colX(6), top).lineTo(colX(6), top + height).stroke();
    if (paise === null || paise === undefined) return;
    text(doc, formatRupeesPart(paise), colX(5) + 2, top + height / 2 - 5, { width: COLS[5].w - 6, align: "right", lineBreak: false });
    text(doc, formatPaisePart(paise), colX(6), top + height / 2 - 5, { width: COLS[6].w, align: "center", lineBreak: false });
  };
  box(M, y, CW - COLS[5].w - COLS[6].w, 20);
  ink(RED, "Helvetica-Bold", 10);
  text(doc, "TOTAL", colX(4), y + 6, { width: COLS[4].w - 6, align: "right" });
  ink(DATA, "Helvetica-Bold", 10);
  amountCells(bill.taxableTotalPaise, y, 20);
  y += 20;

  // ---- bank details (left), CGST / SGST / IGST / GRAND TOTAL (right) -----------------------------------------------------------
  const rowsTop = y;
  const ROW = 21;
  const leftWidth = colX(3) - M;
  box(M, rowsTop, leftWidth, ROW * 4);
  doc.rect(M, rowsTop, 16, ROW * 4).fillAndStroke(RED, RED);
  const cx = M + 8;
  const cyMid = rowsTop + ROW * 2;
  doc.save().rotate(-90, { origin: [cx, cyMid] }).fillColor("#FFFFFF").font("Helvetica-Bold").fontSize(8);
  doc.text("BANK DETAILS", cx - 40, cyMid - 4, { width: 80, align: "center", lineBreak: false });
  doc.restore();
  const bank = seller.bank ?? {};
  [["Bank Name", bank.bankName], ["Branch", bank.branch], ["Account No.", bank.accountNumber], ["IFSC Code", bank.ifsc]].forEach(([label, value], i) => {
    ink(RED, "Helvetica-Bold", 9.5);
    text(doc, label, M + 24, rowsTop + 5 + i * ROW, { width: 70, lineBreak: false });
    ink(DATA, "Helvetica-Bold", 9.5);
    text(doc, `: ${value ?? ""}`, M + 96, rowsTop + 5 + i * ROW, { width: leftWidth - 100, lineBreak: false });
  });
  const groups = taxByRate(bill.items);
  const rates = (pick) => [...new Set(groups.filter((g) => pick(g) > 0).map((g) => g.rateBp))].map((bp) => `${bp / 100}`);
  const intra = bill.taxType === TAX_TYPE.INTRA;
  const taxRows = [
    ["CGST@", intra ? groups.map((g) => g.rateBp / 200) : [], bill.cgstPaise],
    ["SGST@", intra ? groups.map((g) => g.rateBp / 200) : [], bill.sgstPaise],
    ["IGST@", bill.taxType === TAX_TYPE.INTER ? groups.map((g) => g.rateBp / 100) : [], bill.igstPaise],
  ];
  taxRows.forEach(([label, ratesList, paise], i) => {
    const top = rowsTop + i * ROW;
    box(colX(3), top, colX(5) - colX(3), ROW);
    ink(RED, "Helvetica-Bold", 10);
    const rateText = [...new Set(ratesList)].join("/");
    text(doc, `${label} ${rateText} %`.replace("  ", " "), colX(3) + 8, top + 6, { width: colX(5) - colX(3) - 12, lineBreak: false });
    ink(DATA, "Helvetica-Bold", 10);
    amountCells(paise > 0 ? paise : null, top, ROW);
  });
  const gtTop = rowsTop + ROW * 3;
  box(colX(3), gtTop, colX(5) - colX(3), ROW);
  ink(RED, "Helvetica-Bold", 10.5);
  text(doc, "GRAND TOTAL", colX(3) + 8, gtTop + 6, { width: colX(5) - colX(3) - 12, lineBreak: false });
  ink(DATA, "Helvetica-Bold", 10.5);
  amountCells(bill.grandTotalPaise, gtTop, ROW);
  y = rowsTop + ROW * 4;
  if (gst && (bill.taxPending || !bill.taxType)) {
    ink(RED, "Helvetica-Oblique", 7.5);
    text(doc, "GST not applied: tax type undecided", colX(3) + 8, y - ROW * 4 - 9, { width: 200, lineBreak: false });
  }

  // ---- amount in words and signature ---------------------------------------------------------------------------------------------
  const wordsH = WORDS_H;
  const wordsW = CW * 0.6;
  box(M, y, wordsW, wordsH);
  box(M + wordsW, y, CW - wordsW, wordsH);
  ink(RED, "Helvetica", 11);
  text(doc, "Amount in Words", M + 8, y + 8, { width: 100, lineBreak: false });
  doc.moveTo(M + 112, y + 20).lineTo(M + wordsW - 8, y + 23).dash(1, { space: 1 }).stroke().undash();
  doc.moveTo(M + 8, y + 40).lineTo(M + wordsW - 8, y + 38).dash(1, { space: 1 }).stroke().undash();
  ink(DATA, "Helvetica-Bold", 9);
  text(doc, bill.amountInWords, M + 114, y + 8, { width: wordsW - 124, lineGap: 3 });
  ink(RED, "Helvetica", 10);
  text(doc, `For. ${seller.businessName ?? ""}`, M + wordsW + 8, y + 8, { width: CW - wordsW - 16, align: "right", lineBreak: false });
  ink(RED, "Helvetica", 9);
  text(doc, seller.proprietorName ? `${seller.proprietorName}, Proprietor` : "Proprietor", M + wordsW + 8, y + wordsH - 16, { width: CW - wordsW - 16, align: "center", lineBreak: false });

  // ---- page numbers and the cancelled mark ----------------------------------------------------------------------------------------
  const { count } = doc.bufferedPageRange();
  for (let i = 0; i < count; i += 1) {
    doc.switchToPage(i);
    ink("#555555", "Helvetica", 8);
    text(doc, `Page ${i + 1} of ${count}`, M, H - 20, { width: CW, align: "center" });
    if (bill.status === BILL_STATUS.CANCELLED) {
      doc.save().rotate(-35, { origin: [W / 2, H / 2] }).fillColor("#B00020").fillOpacity(0.15).font("Helvetica-Bold").fontSize(96);
      text(doc, "CANCELLED", 0, H / 2 - 48, { width: W, align: "center" });
      doc.restore();
    }
  }
}

const WORDS_H = 62;
const footerHeight = () => 20 + 21 * 4 + WORDS_H;
