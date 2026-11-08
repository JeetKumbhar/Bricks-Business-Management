import { quantityText } from "./invoiceFormat";

// Splits invoice rows over A4 pages. The on-screen invoice, the printout and the PDF all use this, so they agree.
// Every page repeats the letterhead, the customer box and the table header. Only the LAST page carries the
// totals, bank details, amount in words and signature, so those always stay together.

export const CHARS_PER_LINE = 34; // deliberately cautious, so a wrapped description never overflows its row
export const QTY_CHARS_PER_LINE = 14; // same for the quantity + unit text
export const MAX_ROW_UNITS = 14;
export const FINAL_PAGE_UNITS = 18; // room for rows on a page that also has the footer
export const MIDDLE_PAGE_UNITS = 28; // room for rows on a page without the footer

/** How many text lines a row needs (1 or more): the longer of the description and the quantity + unit text. */
export const rowUnits = (item) => {
  const desc = Math.ceil(String(item.particulars ?? "").length / CHARS_PER_LINE);
  const qty = item.quantity === undefined ? 1 : Math.ceil(quantityText(item).length / QTY_CHARS_PER_LINE);
  return Math.min(MAX_ROW_UNITS, Math.max(1, desc, qty));
};

/** -> [[item, ...], ...] always at least one page (the last one has the footer) */
export const paginateItems = (items) => {
  const pages = [];
  let current = [];
  let used = 0;
  for (const item of items) {
    const u = rowUnits(item);
    if (used + u > MIDDLE_PAGE_UNITS && current.length > 0) {
      pages.push(current);
      current = [];
      used = 0;
    }
    current.push(item);
    used += u;
  }
  pages.push(current);

  // the last page also has to fit the footer: move its first rows onto a page of their own if it is too full
  const last = pages[pages.length - 1];
  if (last.reduce((s, it) => s + rowUnits(it), 0) > FINAL_PAGE_UNITS) {
    let tail = [];
    let tailUnits = 0;
    for (let i = last.length - 1; i >= 0; i -= 1) {
      const u = rowUnits(last[i]);
      if (tailUnits + u > FINAL_PAGE_UNITS) break;
      tail = [last[i], ...tail];
      tailUnits += u;
    }
    const head = last.slice(0, last.length - tail.length);
    pages.splice(pages.length - 1, 1, head, tail);
  }
  return pages;
};
