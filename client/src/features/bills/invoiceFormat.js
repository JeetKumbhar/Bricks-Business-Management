// Text formatting shared by the on-screen invoice, the printout and the PDF.
import { formatINR } from "../../utils/money";

/** "2026-11-04" -> "04-11-2026" (the business date is never turned into a Date, so the day cannot shift) */
export const invoiceDate = (iso) => `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}`;

/** 5000 + "Bricks" -> "5,000 Bricks" ; 1200.5 + "Tonnes" -> "1,200.5 Tonnes" */
export const quantityText = (item) => `${Number(item.quantity).toLocaleString("en-IN", { maximumFractionDigits: 3 })} ${item.unit}`;

/** Rate in rupees -> "8.00" */
export const rateText = (item) => formatINR(Math.round(Number(item.rate) * 100));

/** "Rakholi, House No. 185 ..." -> { head: "Rakholi", rest: ", House No. 185 ..." } (the first part is printed bold, as on the bill book) */
export const addressParts = (address) => {
  const text = String(address ?? "");
  const i = text.indexOf(",");
  return i < 0 ? { head: text, rest: "" } : { head: text.slice(0, i), rest: text.slice(i) };
};

/** Phone numbers (a list from the settings; stray blanks dropped) */
export const phoneList = (phones) => (Array.isArray(phones) ? phones : String(phones ?? "").split(/[,;]+/)).map((p) => String(p).trim()).filter(Boolean);

/** Column widths of the item table (fractions of the width): Sr, Particulars, HSN/SAC, Quantity, Rate, Rs., P. */
export const INVOICE_COLUMNS = [0.06, 0.39, 0.1, 0.15, 0.1, 0.15, 0.05];

/** CGST / SGST or IGST rows that apply to a bill (decided by the state codes, see billCalculations), with the printed text ("CGST@ 9 %") */
export const taxRows = (totals) => {
  const label = (name, text) => `${name}@ ${text ? `${text} %` : "%"}`;
  if (totals.taxMode !== "GST" || totals.taxPending) return [];
  if (totals.taxType === "INTRA")
    return [
      { key: "cgst", label: label("CGST", totals.cgstRateText), paise: totals.cgstPaise },
      { key: "sgst", label: label("SGST", totals.sgstRateText), paise: totals.sgstPaise },
    ];
  return [{ key: "igst", label: label("IGST", totals.igstRateText).replace("IGST@", "IGST @"), paise: totals.igstPaise }];
};

/** The invoice layout uses short names; the bill uses the backend's. Missing seller details print as blanks. */
export const invoiceSeller = (bill) => {
  const s = bill.seller ?? {};
  const b = s.bank ?? {};
  return {
    seller: {
      name: s.businessName ?? "",
      description: s.businessDescription ?? "",
      productLine: s.productsLine ?? "",
      address: s.address ?? "",
      phones: s.phones ?? [],
      gstin: s.gstin ?? "",
      pan: s.pan ?? "",
      jurisdiction: s.jurisdiction ?? "",
      signatoryTitle: s.proprietorName ?? "",
    },
    bank: { name: b.bankName ?? "", branch: b.branch ?? "", accountNumber: b.accountNumber ?? "", ifsc: b.ifsc ?? "" },
  };
};

/** Bill number as printed. A draft has none yet, so the box stays empty (the DRAFT mark shows instead). */
export const billNumberText = (bill) => bill.billNumber ?? "";
