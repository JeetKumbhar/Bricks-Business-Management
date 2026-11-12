// Editor form <-> bill conversions. Pure functions. The form keeps everything as typed text until it is validated.
import { parseScaled } from "../../utils/money";
import { BILL_STATUS, emptyCustomer, emptyItemDraft, itemToDraft, TAX_MODE, TAX_TYPE_LABELS } from "./billModel";
import { deriveTaxType } from "./billCalculations";
import { sellerSnapshot } from "./billContract";

export const emptyForm = ({ settings, today }) => ({
  billDate: today,
  taxMode: settings.defaultTaxMode ?? TAX_MODE.GST,
  notes: "",
  customer: emptyCustomer(),
  items: [emptyItemDraft()],
});

export const formFromBill = (bill) => ({
  billDate: bill.billDate,
  taxMode: bill.taxMode,
  notes: bill.notes ?? "",
  customer: { ...emptyCustomer(), ...bill.customer },
  items: bill.items.length > 0 ? bill.items.map(itemToDraft) : [emptyItemDraft()],
});

/** Text that changes when the user changes anything (row keys are ignored). Used for the unsaved-changes warning. */
export const formSignature = (form) => JSON.stringify({ ...form, items: form.items.map(({ key: _key, ...rest }) => rest) });

const lenient = (text, decimals) => {
  const p = parseScaled(text, decimals);
  return p.ok ? p.scaled / 10 ** decimals : 0;
};

/** A bill for the live preview (no number yet, current settings as the seller). Unreadable numbers count as 0 here. */
export const previewBillFromForm = (form, settings, status = BILL_STATUS.DRAFT) => ({
  id: "preview",
  billNumber: null,
  billDate: form.billDate,
  status,
  customer: { ...form.customer },
  taxMode: form.taxMode,
  seller: sellerSnapshot(settings),
  items: form.items.map((it) => ({
    ...(it.sourceTripId ? { sourceTripId: it.sourceTripId } : {}),
    pricingUnit: it.pricingUnit,
    particulars: it.particulars,
    hsn: it.hsn,
    quantity: lenient(it.quantity, 3),
    unit: it.unit,
    rate: lenient(it.rate, 2),
    taxRate: lenient(it.taxRate, 2),
  })),
});

/** Text the PDF cannot draw (it uses standard fonts), so the user is warned before printing a "?" */
export const NON_LATIN = /[^\x20-\x7e\xa0-\xff\n]/;
export const nonLatinFields = (form) => {
  const hits = [];
  if (NON_LATIN.test(form.customer.name) || NON_LATIN.test(form.customer.address)) hits.push("customer name or address");
  if (form.items.some((i) => NON_LATIN.test(i.particulars) || NON_LATIN.test(i.unit))) hits.push("item description or unit");
  return hits;
};

/**
 * How GST will be applied, from the state codes (nothing is chosen by hand).
 * -> { taxType: "INTRA" | "INTER" | null, label, notices: [] }. `notices` explain what is missing when the type is not known yet.
 */
export const taxTypeInfo = (form, sellerStateCode) => {
  if (form.taxMode !== TAX_MODE.GST) return { taxType: null, label: "No GST on this bill", notices: [] };
  const taxType = deriveTaxType(sellerStateCode, form.customer.stateCode);
  const notices = [];
  if (!String(sellerStateCode ?? "").trim()) notices.push("Add your own state code in Settings. It decides CGST + SGST or IGST.");
  if (!String(form.customer.stateCode ?? "").trim()) notices.push("Add the customer's state code. It decides CGST + SGST or IGST. No tax is added until it is known.");
  return { taxType, label: taxType ? `${TAX_TYPE_LABELS[taxType]} (from the state codes)` : "Not known yet", notices };
};

/** Message for a failed finalize: the first problem the backend rules found, with how many more there are. */
export const finalizeErrorText = (error) => {
  const list = error?.problems;
  if (!Array.isArray(list) || list.length === 0) return error?.message ?? "Could not finalize the bill";
  return `Not ready to finalize: ${list[0].message}${list.length > 1 ? ` (and ${list.length - 1} more). Open the draft to fix them.` : ". Open the draft to fix it."}`;
};
