// Validation for bills and invoice settings. Plain functions (no schema library). The rules are copied from the Phase 11 backend
// (server/validators/*.js and the readiness check in server/services/bill.service.js) and the backend stays the authority:
// when the API is connected it repeats every check.
//
//   validateBillInput    -> what the backend accepts when SAVING A DRAFT (half-filled is fine; whatever is typed must be valid)
//   finalizeProblems     -> what the backend requires before a bill can be FINALIZED (complete, GST fields, reviewed ...)
//   validateInvoiceSettings -> the settings shape rules
import { isBusinessDate } from "../utils/businessDate";
import { parseScaled } from "../utils/money";
import { LIMITS, MAX_ITEMS_PER_BILL, MAX_QUANTITY, MAX_RATE, MAX_TAX_RATE, TAX_MODE } from "../features/bills/billModel";
import { computeInvoice, deriveTaxType, rateBasisPoints } from "../features/bills/billCalculations";

// Same patterns as server/constants/bill.js
export const GSTIN_RE = /^(0[1-9]|[1-3]\d|3[0-8])[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
export const PAN_RE = /^[A-Z]{5}\d{4}[A-Z]$/;
export const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
export const STATE_CODE_RE = /^(0[1-9]|[1-3]\d|3[0-8]|9[79])$/;
export const HSN_RE = /^\d{4}(\d{2}(\d{2})?)?$/; // 4, 6 or 8 digits (SAC is 6)
export const PHONE_RE = /^[0-9+\-() ]{6,20}$/;
export const ACCOUNT_RE = /^[0-9A-Za-z]{0,30}$/;
const PREFIX_RE = /^[A-Za-z0-9]{0,10}$/;

const clean = (v) => String(v ?? "").replace(/\s+/g, " ").trim();
export const normalizeGstin = (v) => String(v ?? "").replace(/\s+/g, "").toUpperCase();

/** A GSTIN starts with its state's 2-digit code, so the two must agree when both are given (same rule as the backend). */
export const gstinMatchesState = (gstin, stateCode) => !gstin || !stateCode || !GSTIN_RE.test(gstin) || gstin.slice(0, 2) === stateCode;

/** -> { errors, value }. Nothing is required (a draft may be half-filled); whatever is typed must be valid. */
export const validateCustomer = (c) => {
  const errors = {};
  const name = clean(c?.name);
  const address = String(c?.address ?? "").trim();
  const gstin = normalizeGstin(c?.gstin);
  const stateCode = String(c?.stateCode ?? "").trim();
  const contact = String(c?.contact ?? "").trim();
  const stateName = clean(c?.stateName);
  if (name.length > LIMITS.name) errors.name = `Customer name is too long (max ${LIMITS.name})`;
  if (address.length > LIMITS.address) errors.address = `Address is too long (max ${LIMITS.address})`;
  if (stateName.length > LIMITS.name) errors.stateName = "State name is too long";
  if (gstin && !GSTIN_RE.test(gstin)) errors.gstin = "GSTIN looks wrong. It has 15 characters, like 26ABCDE1234F1Z5";
  if (stateCode && !STATE_CODE_RE.test(stateCode)) errors.stateCode = "State code is 2 digits, like 26";
  if (contact && !PHONE_RE.test(contact)) errors.contact = "Enter a valid contact number";
  if (!errors.gstin && !errors.stateCode && !gstinMatchesState(gstin, stateCode)) errors.stateCode = "The first 2 digits of the GSTIN must match the state code";
  return { errors, value: { name, address, gstin, stateName, stateCode, contact } };
};

const NUMBER_MESSAGES = { format: "Enter a number", decimals: "At most 2 decimals" };

/**
 * One typed item row -> { errors, value }. A blank quantity / rate / tax rate becomes null (allowed in a draft).
 * value: { particulars, hsn, quantity, unit, rate, taxRate } with real NUMBERS, ready for the API.
 */
export const validateItem = (item, taxMode, allowedRates = []) => {
  const errors = {};
  const particulars = clean(item?.particulars);
  const hsn = String(item?.hsn ?? "").trim();
  const unit = clean(item?.unit);
  if (particulars.length > LIMITS.particulars) errors.particulars = `Too long (max ${LIMITS.particulars})`;
  if (hsn && !HSN_RE.test(hsn)) errors.hsn = "HSN/SAC is 4, 6 or 8 digits";
  if (unit.length > LIMITS.unit) errors.unit = `Too long (max ${LIMITS.unit})`;

  let quantity = null;
  if (String(item?.quantity ?? "").trim() !== "") {
    const q = parseScaled(item.quantity, 3);
    if (!q.ok) errors.quantity = q.reason === "decimals" ? "At most 3 decimals" : "Enter a number";
    else if (q.scaled > MAX_QUANTITY * 1000) errors.quantity = "Too large. Please check";
    else quantity = q.scaled / 1000;
  }
  let rate = null;
  if (String(item?.rate ?? "").trim() !== "") {
    const r = parseScaled(item.rate, 2);
    if (!r.ok) errors.rate = r.reason === "decimals" ? "At most 2 decimals" : "Enter a number";
    else if (r.scaled > MAX_RATE * 100) errors.rate = "Too large. Please check";
    else rate = r.scaled / 100;
  }
  let taxRate = null;
  if (taxMode === TAX_MODE.GST && String(item?.taxRate ?? "").trim() !== "") {
    const t = parseScaled(item.taxRate, 2);
    if (!t.ok) errors.taxRate = NUMBER_MESSAGES[t.reason] ?? "Enter a number";
    else if (t.scaled > MAX_TAX_RATE * 100) errors.taxRate = "Cannot be more than 100";
    else {
      taxRate = t.scaled / 100;
      if (allowedRates.length > 0 && !allowedRates.some((a) => Math.round(a * 100) === t.scaled)) errors.taxRate = `Tax rate ${taxRate}% is not in your allowed list (Settings)`;
    }
  }
  return { errors, value: { particulars, hsn, quantity, unit, rate, taxRate } };
};

/**
 * Draft rules. input: { billDate, customer, items (typed rows), taxMode, notes, allowedRates }
 * -> { valid, errors: { billDate?, taxMode?, items?, notes? }, customerErrors, itemErrors: [], value | null }
 * value = { billDate, customer, taxMode, items, notes } (the shape of the backend request, see billContract.js)
 */
export const validateBillInput = ({ billDate, customer, items, taxMode, notes = "", allowedRates = [] }) => {
  const errors = {};
  if (!isBusinessDate(billDate)) errors.billDate = "Choose a valid bill date";
  if (!Object.values(TAX_MODE).includes(taxMode)) errors.taxMode = "Choose GST or non-GST";
  if (items.length > MAX_ITEMS_PER_BILL) errors.items = `A bill can have at most ${MAX_ITEMS_PER_BILL} items`;
  if (String(notes ?? "").trim().length > LIMITS.notes) errors.notes = `Notes are too long (max ${LIMITS.notes})`;
  const cust = validateCustomer(customer);
  const rows = items.map((it) => validateItem(it, taxMode, allowedRates));
  const valid = Object.keys(errors).length === 0 && Object.keys(cust.errors).length === 0 && rows.every((r) => Object.keys(r.errors).length === 0);
  return {
    valid,
    errors,
    customerErrors: cust.errors,
    itemErrors: rows.map((r) => r.errors),
    value: valid ? { billDate, customer: cust.value, taxMode, items: rows.map((r, i) => (items[i]?.sourceTripId ? { ...r.value, sourceTripId: items[i].sourceTripId, pricingUnit: items[i].pricingUnit } : r.value)), notes: String(notes ?? "").trim() } : null,
  };
};

/**
 * What must be true before a bill can be finalized (the backend's readiness check). bill: the saved shape (numbers, null for blanks).
 * seller: the seller details that will be frozen on the invoice (the current settings). -> [{ field, message }] (empty = ready)
 * `field` uses the backend's names: "billDate", "seller", "seller.gstin", "customer.name", "items.0.hsn" ...
 */
export const finalizeProblems = (bill, seller, today) => {
  const problems = [];
  const need = (ok, field, message) => {
    if (!ok) problems.push({ field, message });
  };
  const gst = bill.taxMode === TAX_MODE.GST;
  need(isBusinessDate(bill.billDate) && bill.billDate <= today, "billDate", "A finalized bill cannot be dated in the future");
  need(seller?.businessName && seller?.address, "seller", "Fill the seller's business name and address in Settings first");
  if (gst) {
    need(seller?.gstin, "seller.gstin", "Add the seller's GSTIN in Settings (or switch this bill to non-GST)");
    need(seller?.stateCode, "seller.stateCode", "Add the seller's state code in Settings");
    need(bill.customer.stateCode, "customer.stateCode", "The customer's state code decides CGST+SGST or IGST");
  }
  need(bill.customer.name, "customer.name", "Customer name is required");
  need(bill.customer.address, "customer.address", "Customer address is required");
  need(bill.items.length > 0, "items", "Add at least one item");
  bill.items.forEach((it, i) => {
    need(it.particulars, `items.${i}.particulars`, "Particulars are required");
    need(it.unit, `items.${i}.unit`, "Unit is required");
    need(it.quantity > 0, `items.${i}.quantity`, "Quantity must be greater than 0");
    need(it.rate > 0, `items.${i}.rate`, "Rate must be greater than 0");
    if (gst) {
      need(it.hsn, `items.${i}.hsn`, "HSN/SAC code is required on a GST bill");
      need(it.taxRate !== null && it.taxRate !== undefined, `items.${i}.taxRate`, "Tax rate is required on every item of a GST bill (use 0 if nil-rated)");
    }
  });
  const taxType = gst ? deriveTaxType(seller?.stateCode, bill.customer.stateCode) : null;
  need(computeInvoice(bill.items, bill.taxMode, taxType).grandPaise > 0, "items", "The bill total must be greater than 0");
  return problems;
};

/** [{ field, message }] -> { errors, customerErrors, itemErrors } in the shapes the editor uses to mark fields. */
export const problemsToErrors = (problems, itemCount) => {
  const out = { errors: {}, customerErrors: {}, itemErrors: Array.from({ length: itemCount }, () => ({})), sellerProblems: [] };
  for (const { field, message } of problems) {
    const parts = field.split(".");
    if (parts[0] === "customer") out.customerErrors[parts[1]] ??= message;
    else if (parts[0] === "items" && parts.length === 3) (out.itemErrors[Number(parts[1])] ??= {})[parts[2]] ??= message;
    else if (parts[0] === "seller") out.sellerProblems.push(message);
    else out.errors[parts[0]] ??= message;
  }
  return out;
};

/** Seller / bank / numbering settings (backend rules: every field optional, whatever is typed must be valid). -> { valid, errors } */
export const validateInvoiceSettings = (s) => {
  const errors = {};
  const len = (key, label, max) => {
    if (clean(s[key]).length > max) errors[key] = `${label} is too long (max ${max})`;
  };
  if (clean(s.businessName).length < 2) errors.businessName = "Business name is required";
  len("businessName", "Business name", LIMITS.name);
  len("businessDescription", "Description", LIMITS.description);
  len("productsLine", "Materials line", LIMITS.address);
  len("address", "Address", LIMITS.address);
  len("jurisdiction", "Jurisdiction", LIMITS.name);
  len("stateName", "State", LIMITS.name);
  len("proprietorName", "Signature title", LIMITS.name);
  const gstin = normalizeGstin(s.gstin);
  const pan = String(s.pan ?? "").trim().toUpperCase();
  const stateCode = String(s.stateCode ?? "").trim();
  if (gstin && !GSTIN_RE.test(gstin)) errors.gstin = "GSTIN looks wrong (15 characters)";
  if (pan && !PAN_RE.test(pan)) errors.pan = "PAN looks wrong (like ABCDE1234F)";
  if (stateCode && !STATE_CODE_RE.test(stateCode)) errors.stateCode = "State code is 2 digits";
  if (!errors.gstin && !errors.stateCode && !gstinMatchesState(gstin, stateCode)) errors.stateCode = "The first 2 digits of the GSTIN must match the state code";
  const phones = Array.isArray(s.phones) ? s.phones : [];
  if (phones.length > 4) errors.phones = "At most 4 phone numbers";
  else if (phones.some((p) => !PHONE_RE.test(String(p).trim()))) errors.phones = "A phone number is not valid";
  const bank = s.bank ?? {};
  if (clean(bank.bankName).length > LIMITS.name) errors.bankName = "Bank name is too long";
  if (clean(bank.branch).length > LIMITS.name) errors.branch = "Branch is too long";
  if (!ACCOUNT_RE.test(String(bank.accountNumber ?? "").trim())) errors.accountNumber = "Account number can have letters and digits only (max 30)";
  const ifsc = String(bank.ifsc ?? "").trim().toUpperCase();
  if (ifsc && !IFSC_RE.test(ifsc)) errors.ifsc = "IFSC looks wrong (11 characters, like ABCD0123456)";
  const n = s.numbering ?? {};
  if (!PREFIX_RE.test(String(n.prefix ?? "").trim())) errors.prefix = "Prefix is up to 10 letters or digits";
  if (!["", "/", "-"].includes(n.separator ?? "")) errors.separator = "Choose one of the listed separators";
  if (!Number.isInteger(n.padding) || n.padding < 1 || n.padding > 8) errors.padding = "Use a number from 1 to 8";
  if (!Object.values(TAX_MODE).includes(s.defaultTaxMode)) errors.defaultTaxMode = "Choose GST or non-GST";
  const rates = Array.isArray(s.allowedTaxRates) ? s.allowedTaxRates : [];
  if (rates.length > 20 || rates.some((r) => !(rateBasisPoints(r) !== null && rateBasisPoints(r) <= MAX_TAX_RATE * 100))) errors.allowedTaxRates = "Tax rates are 0 to 100 with at most 2 decimals (max 20 rates)";
  const units = Array.isArray(s.units) ? s.units : [];
  if (units.length > 30 || units.some((u) => !clean(u) || clean(u).length > LIMITS.unit)) errors.units = `Units: at most 30, each 1 to ${LIMITS.unit} characters`;
  return { valid: Object.keys(errors).length === 0, errors };
};
