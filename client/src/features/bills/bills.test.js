// Tests for Bills & Invoices (frontend, compatible with the Phase 11 backend contract).
// Run: npx vitest run src/features/bills
import { describe, expect, it } from "vitest";
import { formatINR, parseScaled, roundDiv, splitRsP } from "../../utils/money";
import { amountInWords } from "../../utils/amountInWords";
import { computeInvoice, deriveTaxType, lineAmountPaise } from "./billCalculations";
import { allocateBillNumber, counterIdFor, financialYear, formatBillNumber } from "./billNumbering";
import { FINAL_PAGE_UNITS, paginateItems, rowUnits } from "./invoicePages";
import { billLabel, billTotals, filterBills, knownCustomers, sortBills, summarizeBills } from "./billSelectors";
import { finalizeProblems, gstinMatchesState, problemsToErrors, validateBillInput, validateCustomer, validateInvoiceSettings, validateItem } from "../../validators/billValidator";
import { BillNotReadyError, createBillService } from "../../services/billService";
import { initialBills, initialInvoiceSettings } from "../../mock/bills";
import { buildInvoicePdf, invoiceFileName } from "./invoicePdf";
import { emptyForm, finalizeErrorText, formFromBill, formSignature, nonLatinFields, previewBillFromForm, taxTypeInfo } from "./billForm";
import { addressParts, invoiceDate, invoiceSeller, phoneList, quantityText, taxRows } from "./invoiceFormat";
import { fromBillDto, fromSettingsDto, sellerSnapshot, toBillRequest, toCancelRequest, toFinalizeRequest, toSettingsRequest } from "./billContract";

const TODAY = "2026-11-04";
const row = (o = {}) => ({ particulars: "Bricks", hsn: "6901", quantity: "5000", unit: "Bricks", rate: "8", taxRate: "18", ...o });
const cust = (o = {}) => ({ name: "Shree Ganesh", address: "Silvassa", gstin: "", stateName: "", stateCode: "26", contact: "", ...o });
// a seller that is complete enough to finalize a GST bill (fake values for tests only)
const SELLER = { businessName: "Test Traders", address: "1 Test Road", gstin: "26ABCDE1234F1Z5", stateCode: "26" };
const INTRA = "INTRA";
const INTER = "INTER";

describe("money", () => {
  it("reads decimal text exactly", () => {
    expect(parseScaled("12.5", 2)).toEqual({ ok: true, scaled: 1250 });
    expect(parseScaled(".5", 2).scaled).toBe(50);
    expect(parseScaled("5.", 2).scaled).toBe(500);
    for (const bad of ["", "abc", "1e3", "-1", "1.234"]) expect(parseScaled(bad, 2).ok).toBe(false);
  });
  it("rounds half up", () => {
    expect(roundDiv(5, 10)).toBe(1);
    expect(roundDiv(4, 10)).toBe(0);
    expect(roundDiv(25, 10)).toBe(3);
  });
  it("formats Indian grouping with two decimals", () => {
    expect(formatINR(0)).toBe("0.00");
    expect(formatINR(5)).toBe("0.05");
    expect(formatINR(123456)).toBe("1,234.56");
    expect(formatINR(12345650)).toBe("1,23,456.50");
    expect(formatINR(1234567890)).toBe("1,23,45,678.90");
    expect(splitRsP(5310000)).toEqual({ rs: "53,100", p: "00" });
  });
});

describe("amount in words (Indian system)", () => {
  it("handles the common cases", () => {
    expect(amountInWords(4500000)).toBe("Rupees Forty Five Thousand Only.");
    expect(amountInWords(0)).toBe("Rupees Zero Only.");
    expect(amountInWords(100000 * 100)).toBe("Rupees One Lakh Only.");
    expect(amountInWords(10000000 * 100)).toBe("Rupees One Crore Only.");
    expect(amountInWords(5)).toBe("Rupees Zero and Five Paise Only.");
    expect(amountInWords(1250)).toBe("Rupees Twelve and Fifty Paise Only.");
    expect(amountInWords(5310000)).toBe("Rupees Fifty Three Thousand One Hundred Only.");
  });
  it("handles lakhs and crores", () => {
    expect(amountInWords(123456789 * 100)).toBe("Rupees Twelve Crore Thirty Four Lakh Fifty Six Thousand Seven Hundred Eighty Nine Only.");
    expect(amountInWords(10100000 * 100 + 99)).toBe("Rupees One Crore One Lakh and Ninety Nine Paise Only.");
    expect(amountInWords(11 * 100)).toBe("Rupees Eleven Only.");
    expect(amountInWords(90000 * 100)).toBe("Rupees Ninety Thousand Only.");
  });
});

describe("invoice calculations (same rules as the backend)", () => {
  it("quantity x rate, rounded to the paisa", () => {
    expect(lineAmountPaise("5000", "8")).toBe(4000000);
    expect(lineAmountPaise("2.5", "8.5")).toBe(2125);
    expect(lineAmountPaise("1.005", "1")).toBe(101); // 100.5 paise -> half up
    expect(lineAmountPaise("0", "10")).toBe(0);
    expect(lineAmountPaise("", "10")).toBeNull();
  });
  it("CGST + SGST: the worked example (45,000 at 18% = 53,100)", () => {
    const c = computeInvoice([row(), row({ particulars: "Sand", quantity: "2", unit: "Tonnes", rate: "1500" }), row({ particulars: "Stone", quantity: "1", unit: "Tonnes", rate: "2000" })], "GST", INTRA);
    expect(c.taxablePaise).toBe(4500000);
    expect([c.cgstPaise, c.sgstPaise, c.igstPaise]).toEqual([405000, 405000, 0]);
    expect(c.grandPaise).toBe(5310000);
    expect(c.cgstRateText).toBe("9");
  });
  it("IGST takes the full rate; a non-GST bill ignores the tax column", () => {
    const igst = computeInvoice([row({ quantity: "1", rate: "45000" })], "GST", INTER);
    expect([igst.cgstPaise, igst.sgstPaise, igst.igstPaise, igst.grandPaise]).toEqual([0, 0, 810000, 5310000]);
    expect(igst.igstRateText).toBe("18");
    const none = computeInvoice([row({ quantity: "1", rate: "45000" })], "NON_GST", INTRA);
    expect([none.taxPaise, none.grandPaise, none.taxType]).toEqual([0, 4500000, null]);
  });
  it("GST is rounded PER LINE, not per rate group (the backend rule)", () => {
    // two lines of 1.01 at 5%: per line cgst = round(101 x 5 / 200) = round(2.525) = 3 each -> 6; per group would be round(202 x 5 / 200) = round(5.05) = 5
    const lines = [row({ quantity: "1", rate: "1.01", taxRate: "5" }), row({ quantity: "1", rate: "1.01", taxRate: "5" })];
    const c = computeInvoice(lines, "GST", INTRA);
    expect(c.lines.map((l) => l.cgstPaise)).toEqual([3, 3]);
    expect([c.cgstPaise, c.sgstPaise]).toEqual([6, 6]);
    expect(c.grandPaise).toBe(202 + 12);
    const i = computeInvoice(lines, "GST", INTER); // igst per line = round(101 x 5 / 100) = round(5.05) = 5 each
    expect(i.lines.map((l) => l.igstPaise)).toEqual([5, 5]);
    expect(i.igstPaise).toBe(10);
  });
  it("totals are exact sums of the per-line figures", () => {
    const c = computeInvoice([row({ quantity: "3", rate: "3.33", taxRate: "12" }), row({ quantity: "7", rate: "1.17", taxRate: "5" }), row({ quantity: "2.5", rate: "9.99", taxRate: "18" })], "GST", INTRA);
    const sum = (k) => c.lines.reduce((s, l) => s + l[k], 0);
    expect([c.taxablePaise, c.cgstPaise, c.sgstPaise]).toEqual([sum("amountPaise"), sum("cgstPaise"), sum("sgstPaise")]);
    expect(c.grandPaise).toBe(c.taxablePaise + c.cgstPaise + c.sgstPaise + c.igstPaise);
    expect(c.lines.every((l) => l.totalPaise === l.amountPaise + l.cgstPaise + l.sgstPaise + l.igstPaise)).toBe(true);
  });
  it("mixed rates are labelled mixed and amounts stay exact", () => {
    const c = computeInvoice([row({ quantity: "1", rate: "1000", taxRate: "5" }), row({ quantity: "1", rate: "1000", taxRate: "18" })], "GST", INTRA);
    expect(c.slabs.map((s) => s.rateBp)).toEqual([500, 1800]);
    expect(c.cgstPaise).toBe(2500 + 9000);
    expect(c.cgstRateText).toBe("mixed");
    expect(c.grandPaise).toBe(200000 + 2 * 11500);
  });
  it("half-paisa tax rounds half up", () => {
    expect(computeInvoice([row({ quantity: "1", rate: "10.01", taxRate: "5" })], "GST", INTRA).cgstPaise).toBe(25); // 1001 x 5 / 200 = 25.025
    expect(computeInvoice([row({ quantity: "1", rate: "10.01", taxRate: "5" })], "GST", INTER).igstPaise).toBe(50);
    expect(computeInvoice([row({ quantity: "1", rate: "0.10", taxRate: "5" })], "GST", INTRA).cgstPaise).toBe(0); // 10 x 5 / 200 = 0.25 rounds down
  });
  it("no floating point drift", () => {
    expect(computeInvoice([row({ quantity: "3", rate: "0.1", taxRate: "0" })], "GST", INTRA).grandPaise).toBe(30);
    expect(lineAmountPaise("0.1", "0.2")).toBe(2);
  });
  it("tax type comes from the state codes, and is never guessed", () => {
    expect(deriveTaxType("26", "26")).toBe(INTRA);
    expect(deriveTaxType("26", "24")).toBe(INTER);
    expect(deriveTaxType("26", "")).toBeNull();
    expect(deriveTaxType("", "26")).toBeNull();
    expect(deriveTaxType(undefined, undefined)).toBeNull();
  });
  it("GST with an unknown tax type adds no tax and is marked pending", () => {
    const c = computeInvoice([row({ quantity: "1", rate: "1000" })], "GST", null);
    expect([c.taxPending, c.taxPaise, c.grandPaise]).toEqual([true, 0, 100000]);
    expect(taxRows(c)).toEqual([]);
    expect(computeInvoice([row()], "NON_GST", null).taxPending).toBe(false);
  });
  it("a half-filled draft still totals (blank numbers count as 0)", () => {
    const c = computeInvoice([row({ quantity: "", rate: "" }), row({ quantity: "2", rate: "10", taxRate: "" })], "GST", INTRA);
    expect(c.grandPaise).toBe(2000);
  });
  it("billTotals derives the tax type from the bill's seller snapshot and customer", () => {
    const bill = { taxMode: "GST", seller: { stateCode: "26" }, customer: { stateCode: "24" }, items: [row({ quantity: 1, rate: 1000, taxRate: 5 })] };
    expect(billTotals(bill).taxType).toBe(INTER);
    expect(billTotals({ ...bill, customer: { stateCode: "26" } }).taxType).toBe(INTRA);
    expect(billTotals({ ...bill, seller: {} }).taxPending).toBe(true);
  });
});

describe("bill numbers (backend rules: drafts have none, the number is allocated at finalize)", () => {
  const numbering = { prefix: "AC", separator: "/", includeFinancialYear: true, padding: 4 };
  it("financial year starts in April", () => {
    expect(financialYear("2026-11-04")).toBe("2026-27");
    expect(financialYear("2027-03-31")).toBe("2026-27");
    expect(financialYear("2027-04-01")).toBe("2027-28");
  });
  it("formats like the backend", () => {
    expect(formatBillNumber({ numbering, financialYear: "2026-27", seq: 1 })).toBe("AC/2026-27/0001");
    expect(formatBillNumber({ numbering: { prefix: "X", separator: "-", includeFinancialYear: false, padding: 3 }, financialYear: "2026-27", seq: 5 })).toBe("X-005");
    expect(formatBillNumber({ numbering: { prefix: "", separator: "", includeFinancialYear: true, padding: 2 }, financialYear: "2026-27", seq: 7 })).toBe("2026-2707");
    expect(counterIdFor({ numbering, financialYear: "2026-27" })).toBe("bill:AC:2026-27");
    expect(counterIdFor({ numbering: { ...numbering, includeFinancialYear: false }, financialYear: "2026-27" })).toBe("bill:AC:all");
  });
  it("continues after the highest number of the same series, counting cancelled ones; a new year starts again", () => {
    expect(allocateBillNumber([], numbering, "2026-11-04")).toMatchObject({ billNumber: "AC/2026-27/0001", sequence: 1, numberSeries: "bill:AC:2026-27", financialYear: "2026-27" });
    const bills = [
      { numberSeries: "bill:AC:2026-27", sequence: 1 },
      { numberSeries: "bill:AC:2026-27", sequence: 7, status: "CANCELLED" },
      { numberSeries: "bill:AC:2025-26", sequence: 50 },
      { numberSeries: undefined, sequence: undefined }, // a draft
    ];
    expect(allocateBillNumber(bills, numbering, "2026-11-04").billNumber).toBe("AC/2026-27/0008");
    expect(allocateBillNumber(bills, numbering, "2027-04-02").billNumber).toBe("AC/2027-28/0001");
  });
  it("billLabel shows Draft while a bill has no number", () => {
    expect(billLabel({ billNumber: null })).toBe("Draft");
    expect(billLabel({ billNumber: "AC/2026-27/0003" })).toBe("AC/2026-27/0003");
  });
});

describe("pagination", () => {
  const items = (n, text = "Bricks") => Array.from({ length: n }, (_, i) => ({ particulars: `${text} ${i}` }));
  const units = (page) => page.reduce((s, it) => s + rowUnits(it), 0);
  it("a short invoice is one page", () => {
    expect(paginateItems(items(5))).toHaveLength(1);
    expect(paginateItems([])).toEqual([[]]);
  });
  it("a long invoice keeps every row, in order, and the last page fits the footer", () => {
    for (const n of [18, 19, 30, 40, 70, 120]) {
      const pages = paginateItems(items(n));
      expect(pages.flat().map((i) => i.particulars)).toEqual(items(n).map((i) => i.particulars));
      expect(units(pages[pages.length - 1]) > FINAL_PAGE_UNITS).toBe(false);
      expect(pages.every((p) => p.length > 0)).toBe(true);
    }
    expect(paginateItems(items(19))).toHaveLength(2);
  });
  it("long descriptions take more lines", () => {
    expect(rowUnits({ particulars: "x".repeat(10) })).toBe(1);
    expect(rowUnits({ particulars: "x".repeat(100) })).toBe(3);
    const pages = paginateItems(items(14, "A very long material description that wraps onto two lines"));
    expect(pages.length).toBeGreaterThan(1);
  });
});

describe("validation: drafts follow the backend request rules", () => {
  it("customer: nothing is required for a draft, whatever is typed must be valid", () => {
    expect(validateCustomer({}).errors).toEqual({});
    expect(validateCustomer({ name: "x".repeat(121) }).errors.name).toBeTruthy();
    expect(validateCustomer({ address: "x".repeat(301) }).errors.address).toBeTruthy();
    expect(validateCustomer({ gstin: "bad" }).errors.gstin).toBeTruthy();
    expect(validateCustomer({ stateCode: "9" }).errors.stateCode).toBeTruthy();
    expect(validateCustomer({ stateCode: "40" }).errors.stateCode).toBeTruthy();
    expect(validateCustomer({ stateCode: "00" }).errors.stateCode).toBeTruthy();
    expect(validateCustomer({ stateCode: "97" }).errors).toEqual({});
    expect(validateCustomer({ contact: "abc" }).errors.contact).toBeTruthy();
    expect(validateCustomer({ contact: "+91 98765-43210" }).errors).toEqual({});
  });
  it("a typed GSTIN is upper-cased and its first two digits must match the state code", () => {
    const ok = validateCustomer({ gstin: " 24aaacm5678k1z2 ", stateCode: "24" });
    expect(ok.errors).toEqual({});
    expect(ok.value.gstin).toBe("24AAACM5678K1Z2");
    expect(validateCustomer({ gstin: "24AAACM5678K1Z2", stateCode: "26" }).errors.stateCode).toMatch(/first 2 digits/);
    expect(validateCustomer({ gstin: "24AAACM5678K1Z2", stateCode: "" }).errors).toEqual({}); // no code typed yet
    expect(gstinMatchesState("24AAACM5678K1Z2", "24")).toBe(true);
    expect(gstinMatchesState("24AAACM5678K1Z2", "26")).toBe(false);
    expect(gstinMatchesState("", "26")).toBe(true);
  });
  it("items: blanks are allowed, typed values are checked, numbers are real numbers", () => {
    const blank = validateItem({ particulars: "", hsn: "", quantity: "", unit: "", rate: "", taxRate: "" }, "GST");
    expect(blank.errors).toEqual({});
    expect(blank.value).toEqual({ particulars: "", hsn: "", quantity: null, unit: "", rate: null, taxRate: null });
    const good = validateItem(row({ quantity: "2.5", rate: "8.25", taxRate: "5" }), "GST").value;
    expect([good.quantity, good.rate, good.taxRate]).toEqual([2.5, 8.25, 5]);
    expect(typeof good.quantity === "number" && typeof good.rate === "number" && typeof good.taxRate === "number").toBe(true);
    expect(validateItem(row({ quantity: "1.2345" }), "GST").errors.quantity).toBeTruthy();
    expect(validateItem(row({ rate: "1.234" }), "GST").errors.rate).toBeTruthy();
    expect(validateItem(row({ taxRate: "5.123" }), "GST").errors.taxRate).toBeTruthy();
    expect(validateItem(row({ taxRate: "101" }), "GST").errors.taxRate).toBeTruthy();
    expect(validateItem(row({ quantity: "1000001" }), "GST").errors.quantity).toBeTruthy();
    expect(validateItem(row({ hsn: "123" }), "GST").errors.hsn).toBeTruthy();
    expect(validateItem(row({ hsn: "12345" }), "GST").errors.hsn).toBeTruthy();
    for (const hsn of ["1234", "123456", "12345678", ""]) expect(validateItem(row({ hsn }), "GST").errors.hsn).toBeUndefined();
    expect(validateItem(row({ unit: "x".repeat(21) }), "GST").errors.unit).toBeTruthy();
    expect(validateItem(row({ particulars: "x".repeat(201) }), "GST").errors.particulars).toBeTruthy();
  });
  it("a non-GST bill ignores the tax column (the backend rejects a tax rate there)", () => {
    expect(validateItem(row({ taxRate: "5" }), "NON_GST").value.taxRate).toBeNull();
    const req = toBillRequest(validateBillInput({ billDate: TODAY, customer: cust(), items: [row({ taxRate: "5" })], taxMode: "NON_GST" }).value);
    expect(req.items[0].taxRate).toBeNull();
  });
  it("allowed tax rates from Settings are enforced when the list is not empty", () => {
    expect(validateItem(row({ taxRate: "5" }), "GST", [0, 5, 18]).errors.taxRate).toBeUndefined();
    expect(validateItem(row({ taxRate: "12" }), "GST", [0, 5, 18]).errors.taxRate).toMatch(/allowed list/);
  });
  it("bill: needs a real date and a valid type; the future is only blocked at finalize", () => {
    const base = { billDate: TODAY, customer: cust(), items: [row()], taxMode: "GST" };
    expect(validateBillInput(base).valid).toBe(true);
    expect(validateBillInput({ ...base, billDate: "2026-02-30" }).errors.billDate).toBeTruthy();
    expect(validateBillInput({ ...base, taxMode: "CGST_SGST" }).errors.taxMode).toBeTruthy();
    expect(validateBillInput({ ...base, billDate: "2030-01-01" }).valid).toBe(true);
    expect(validateBillInput({ ...base, items: [] }).valid).toBe(true); // an empty draft can be saved
    expect(validateBillInput({ ...base, items: Array.from({ length: 101 }, () => row()) }).errors.items).toBeTruthy();
    expect(validateBillInput({ ...base, notes: "x".repeat(501) }).errors.notes).toBeTruthy();
  });
});

describe("validation: finalize follows the backend readiness rules", () => {
  const ready = () => ({
    billDate: TODAY,
    taxMode: "GST",
    customer: { name: "Shree Ganesh", address: "Silvassa", gstin: "", stateName: "", stateCode: "26", contact: "" },
    items: [{ particulars: "Bricks", hsn: "6901", quantity: 100, unit: "Bricks", rate: 8, taxRate: 5 }],
  });
  const fields = (bill, seller = SELLER) => finalizeProblems(bill, seller, TODAY).map((p) => p.field);
  it("a complete bill is ready", () => {
    expect(fields(ready())).toEqual([]);
  });
  it("needs the customer name and address", () => {
    const b = ready();
    b.customer.name = "";
    b.customer.address = "";
    expect(fields(b)).toEqual(["customer.name", "customer.address"]);
  });
  it("needs a customer state code on a GST bill, but not on a non-GST bill", () => {
    const b = ready();
    b.customer.stateCode = "";
    expect(fields(b)).toEqual(["customer.stateCode"]);
    expect(fields({ ...b, taxMode: "NON_GST" })).toEqual([]);
  });
  it("needs HSN, rate, quantity, particulars, unit and a tax rate on every GST item", () => {
    const b = ready();
    b.items = [{ particulars: "", hsn: "", quantity: null, unit: "", rate: null, taxRate: null }];
    expect(fields(b)).toEqual(["items.0.particulars", "items.0.unit", "items.0.quantity", "items.0.rate", "items.0.hsn", "items.0.taxRate", "items"]);
  });
  it("a tax rate of 0 is allowed (nil-rated) but a rate of 0 is not", () => {
    const b = ready();
    b.items[0].taxRate = 0;
    expect(fields(b)).toEqual([]);
    b.items[0].rate = 0;
    expect(fields(b)).toContain("items.0.rate");
  });
  it("non-GST items do not need HSN or a tax rate", () => {
    const b = ready();
    b.taxMode = "NON_GST";
    b.items[0] = { particulars: "Soil", hsn: "", quantity: 4, unit: "Tonnes", rate: 700, taxRate: null };
    expect(fields(b)).toEqual([]);
  });
  it("needs at least one item and a total above 0", () => {
    const b = ready();
    b.items = [];
    expect(fields(b)).toEqual(["items", "items"]);
  });
  it("cannot be dated in the future", () => {
    expect(fields({ ...ready(), billDate: "2026-11-05" })).toEqual(["billDate"]);
  });
  it("needs the seller's business name and address, and on a GST bill the GSTIN and state code", () => {
    expect(fields(ready(), { businessName: "T", address: "", gstin: "x", stateCode: "26" })).toEqual(["seller"]);
    expect(fields(ready(), { businessName: "T", address: "A", gstin: "", stateCode: "" })).toEqual(["seller.gstin", "seller.stateCode"]);
    expect(fields({ ...ready(), taxMode: "NON_GST", items: [{ particulars: "Soil", quantity: 1, unit: "T", rate: 10, taxRate: null }] }, { businessName: "T", address: "A" })).toEqual([]);
  });
  it("maps problems to the fields the editor marks", () => {
    const m = problemsToErrors([{ field: "customer.name", message: "a" }, { field: "items.1.hsn", message: "b" }, { field: "seller.gstin", message: "c" }, { field: "billDate", message: "d" }, { field: "items", message: "e" }], 2);
    expect(m.customerErrors.name).toBe("a");
    expect(m.itemErrors[1].hsn).toBe("b");
    expect(m.sellerProblems).toEqual(["c"]);
    expect(m.errors).toEqual({ billDate: "d", items: "e" });
  });
});

describe("validation: invoice settings follow the backend", () => {
  const good = () => ({ ...structuredClone(initialInvoiceSettings), gstin: "26ABCDE1234F1Z5", pan: "ABCDE1234F", phones: ["98765 43210"], bank: { bankName: "Test Bank", branch: "Main", accountNumber: "123456789012", ifsc: "ABCD0123456" } });
  it("accepts correct and empty details, catches bad ones", () => {
    expect(validateInvoiceSettings(good()).valid).toBe(true);
    expect(validateInvoiceSettings(initialInvoiceSettings).valid).toBe(true); // nothing is required except the business name
    const bad = { ...good(), gstin: "x", pan: "y", stateCode: "9", phones: ["abc"], bank: { ...good().bank, ifsc: "z", accountNumber: "12 34" } };
    expect(Object.keys(validateInvoiceSettings(bad).errors).sort()).toEqual(["accountNumber", "gstin", "ifsc", "pan", "phones", "stateCode"]);
  });
  it("the settings GSTIN must start with the state code", () => {
    expect(validateInvoiceSettings({ ...good(), stateCode: "24" }).errors.stateCode).toMatch(/first 2 digits/);
  });
  it("checks numbering, tax rates and units", () => {
    const e = validateInvoiceSettings({ ...good(), numbering: { prefix: "A B", separator: "+", includeFinancialYear: true, padding: 9 }, allowedTaxRates: [101], units: ["x".repeat(21)] }).errors;
    expect(Object.keys(e).sort()).toEqual(["allowedTaxRates", "padding", "prefix", "separator", "units"]);
    expect(validateInvoiceSettings({ ...good(), businessName: "A" }).errors.businessName).toBeTruthy();
  });
});

describe("backend request and response mappers", () => {
  const value = () => validateBillInput({ billDate: TODAY, taxMode: "GST", notes: " hello ", customer: cust({ gstin: "26abcde1234f1z5", stateName: "Gujarat", contact: "9876543210" }), items: [row({ quantity: "2.5", rate: "8.25", taxRate: "5" })] }).value;
  it("builds exactly the fields the backend accepts, with numbers as numbers", () => {
    const req = toBillRequest(value());
    expect(Object.keys(req).sort()).toEqual(["billDate", "customer", "items", "notes", "taxMode"]);
    expect(Object.keys(req.customer).sort()).toEqual(["address", "contact", "gstin", "name", "stateCode", "stateName"]);
    expect(Object.keys(req.items[0]).sort()).toEqual(["hsn", "particulars", "quantity", "rate", "taxRate", "unit"]);
    expect(req.items[0]).toMatchObject({ quantity: 2.5, rate: 8.25, taxRate: 5 });
    expect(req.customer.gstin).toBe("26ABCDE1234F1Z5");
    expect(req.notes).toBe("hello");
    // never sends totals, tax amounts, status, tax type or a bill number (the strict backend would reject them)
    const text = JSON.stringify(req);
    for (const forbidden of ["billNumber", "number", "status", "taxType", "cgst", "sgst", "igst", "grandTotal", "taxable", "reference"]) expect(text).not.toContain(forbidden);
    expect(JSON.parse(text)).toEqual(req);
  });
  it("every typed decimal becomes the exact JSON number", () => {
    for (const q of ["0.001", "1.1", "2.675", "99.999", "123456.789", "0.1", "0.7"]) {
      const v = validateItem(row({ quantity: q }), "GST").value;
      expect(String(v.quantity)).toBe(String(Number(q)));
      expect(JSON.stringify({ q: v.quantity })).toBe(`{"q":${Number(q)}}`);
    }
    for (const r of ["0.07", "1.15", "19.99", "4.35", "1000000"]) expect(validateItem(row({ rate: r }), "GST").value.rate).toBe(Number(r));
  });
  it("leaves a blank quantity or rate out of a draft request and sends a blank tax rate as null", () => {
    const v = validateBillInput({ billDate: TODAY, taxMode: "GST", customer: cust(), items: [row({ quantity: "", rate: "", taxRate: "" })] }).value;
    const item = toBillRequest(v).items[0];
    expect("quantity" in item).toBe(false);
    expect("rate" in item).toBe(false);
    expect(item.taxRate).toBeNull();
  });
  it("adds the revision when updating", () => {
    expect(toBillRequest(value(), 3).revision).toBe(3);
    expect("revision" in toBillRequest(value())).toBe(false);
  });
  it("finalize and cancel bodies", () => {
    expect(toFinalizeRequest()).toEqual({ reviewed: true });
    expect(toFinalizeRequest(4)).toEqual({ reviewed: true, revision: 4 });
    expect(toCancelRequest("  wrong customer ")).toEqual({ reason: "wrong customer" });
  });
  it("settings request: bank object, phone list, numbering object, numeric tax rates", () => {
    const req = toSettingsRequest({ ...initialInvoiceSettings, gstin: " 26abcde1234f1z5 ", pan: "abcde1234f", phones: [" 98765 43210 ", ""], bank: { bankName: " B ", branch: "", accountNumber: "123", ifsc: "abcd0123456" }, allowedTaxRates: ["5", 18], units: [" Bricks ", ""] });
    expect(Object.keys(req).sort()).toEqual(["address", "allowedTaxRates", "bank", "businessDescription", "businessName", "defaultTaxMode", "gstin", "jurisdiction", "numbering", "pan", "phones", "productsLine", "proprietorName", "stateCode", "stateName", "units"]);
    expect(req).toMatchObject({ gstin: "26ABCDE1234F1Z5", pan: "ABCDE1234F", phones: ["98765 43210"], allowedTaxRates: [5, 18], units: ["Bricks"] });
    expect(req.bank).toEqual({ bankName: "B", branch: "", accountNumber: "123", ifsc: "ABCD0123456" });
    expect(req.numbering).toEqual({ prefix: "AC", separator: "/", includeFinancialYear: true, padding: 4 });
  });
  it("reads a bill from the API (rate comes in paise) and settings with missing lists", () => {
    const bill = fromBillDto({ id: "1", billNumber: "AC/2026-27/0001", status: "FINALIZED", customer: { name: "A" }, items: [{ particulars: "Bricks", hsn: "6901", quantity: 2.5, unit: "Bricks", ratePaise: 825, taxRate: 5 }] });
    expect(bill.items[0]).toMatchObject({ particulars: "Bricks", hsn: "6901", quantity: 2.5, unit: "Bricks", rate: 8.25, taxRate: 5 });
    expect(bill.customer).toMatchObject({ name: "A", address: "", stateName: "", contact: "" });
    expect(fromBillDto({ id: "2", customer: {}, items: [{ particulars: "x", quantity: 1, unit: "u", ratePaise: 100, taxRate: null }] }).items[0].taxRate).toBeNull();
    const s = fromSettingsDto({ businessName: "A", numbering: { prefix: "AC" } });
    expect([s.phones, s.allowedTaxRates, s.units, s.bank.ifsc]).toEqual([[], [], [], ""]);
  });
  it("the seller snapshot has the backend's seller fields only", () => {
    expect(Object.keys(sellerSnapshot(initialInvoiceSettings)).sort()).toEqual(["address", "bank", "businessDescription", "businessName", "gstin", "jurisdiction", "pan", "phones", "proprietorName", "productsLine", "stateCode", "stateName"].sort());
    const snap = sellerSnapshot({ ...initialInvoiceSettings, bank: { bankName: "X" } });
    snap.bank.bankName = "changed";
    expect(initialInvoiceSettings.bank.bankName).toBe("");
  });
});

describe("demo data and dashboard numbers", () => {
  it("has the requested mix, drafts without a number and unique numbers on issued bills", () => {
    expect(initialBills).toHaveLength(6);
    const by = (s) => initialBills.filter((b) => b.status === s);
    expect([by("DRAFT").length, by("FINALIZED").length, by("CANCELLED").length]).toEqual([2, 3, 1]);
    expect(by("DRAFT").every((b) => b.billNumber === null)).toBe(true);
    const numbers = initialBills.filter((b) => b.status !== "DRAFT").map((b) => b.billNumber);
    expect(new Set(numbers).size).toBe(numbers.length);
    expect(numbers[0]).toMatch(/^AC\/\d{4}-\d{2}\/0001$/);
    expect(initialBills.every((b) => b.isDemo)).toBe(true);
  });
  it("has no real business details in the mock data", () => {
    const s = initialInvoiceSettings;
    expect([s.gstin, s.pan, s.address, s.bank.accountNumber, s.bank.ifsc, s.bank.bankName, s.jurisdiction]).toEqual(["", "", "", "", "", "", ""]);
    expect(s.phones).toEqual([]);
  });
  it("uses the backend field names", () => {
    const b = initialBills[0];
    expect(b.customer).toHaveProperty("stateName");
    expect(b.customer).toHaveProperty("contact");
    expect(b).toHaveProperty("notes");
    expect(b.seller).toHaveProperty("bank");
    expect(b).not.toHaveProperty("number");
    expect(b).not.toHaveProperty("reference");
  });
  it("only FINALIZED bills count as invoiced", () => {
    const s = summarizeBills(initialBills);
    expect([s.total, s.draft, s.finalized, s.cancelled]).toEqual([6, 2, 3, 1]);
    const expected = initialBills.filter((b) => b.status === "FINALIZED").reduce((n, b) => n + billTotals(b).grandPaise, 0);
    expect(s.invoicedPaise).toBe(expected);
    expect(s.invoicedPaise).toBeGreaterThan(0);
  });
  it("derives the sample taxes from the state codes", () => {
    expect(billTotals(initialBills[0]).taxType).toBe(INTRA);
    expect(billTotals(initialBills[1]).taxType).toBe(INTER);
    expect(billTotals(initialBills[3]).taxPaise).toBe(0);
  });
  it("search, dates and status work together; sorted newest first", () => {
    expect(filterBills(initialBills, { search: "maruti" })).toHaveLength(1);
    expect(filterBills(initialBills, { search: initialBills[0].billNumber }).map((b) => b.id)).toEqual([initialBills[0].id]);
    expect(filterBills(initialBills, { status: "DRAFT" })).toHaveLength(2);
    expect(filterBills(initialBills, { search: "no-such" })).toHaveLength(0);
    const sorted = sortBills(initialBills);
    expect(sorted[0].billDate >= sorted[sorted.length - 1].billDate).toBe(true);
  });
  it("lists known customers once each", () => {
    const names = knownCustomers([...initialBills, { ...initialBills[0], id: "dup" }]).map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("bill service (in memory, backend rules)", () => {
  const fresh = () => createBillService(initialBills, { ...structuredClone(initialInvoiceSettings), gstin: "26ABCDE1234F1Z5", address: "1 Test Road" });
  const request = (o = {}) => toBillRequest(validateBillInput({ billDate: TODAY, taxMode: "GST", customer: cust(), items: [row({ taxRate: "5" })], ...o }).value);
  it("saves a draft WITHOUT a bill number, and edits it", async () => {
    const svc = fresh();
    const draft = await svc.saveDraft(null, request());
    expect(draft.billNumber).toBeNull();
    expect(draft.status).toBe("DRAFT");
    const edited = await svc.saveDraft(draft.id, { ...request({ customer: cust({ name: "Changed" }) }), revision: draft.revision });
    expect(edited.customer.name).toBe("Changed");
    expect(edited.billNumber).toBeNull();
    expect(edited.revision).toBe(draft.revision + 1);
  });
  it("saves half-filled drafts but rejects invalid typed values", async () => {
    const svc = fresh();
    await expect(svc.saveDraft(null, { billDate: TODAY, taxMode: "GST", customer: {}, items: [], notes: "" })).resolves.toBeTruthy();
    await expect(svc.saveDraft(null, { ...request(), customer: { ...request().customer, stateCode: "9" } })).rejects.toThrow(/not valid/);
    expect((await svc.listBills()).length).toBe(initialBills.length + 1);
  });
  it("finalize allocates the number, freezes the seller and needs reviewed: true", async () => {
    const svc = fresh();
    const draft = await svc.saveDraft(null, request());
    await expect(svc.finalizeBill(draft.id, {}, { today: TODAY })).rejects.toThrow(/reviewed/);
    const done = await svc.finalizeBill(draft.id, toFinalizeRequest(draft.revision), { today: TODAY });
    expect(done.status).toBe("FINALIZED");
    expect(done.billNumber).toMatch(/\/0005$/); // four demo bills were already issued this series
    expect(done.seller.gstin).toBe("26ABCDE1234F1Z5");
    expect(done.finalizedAt).toBeTruthy();
  });
  it("finalize reports every missing field and burns no number", async () => {
    const svc = fresh();
    const draft = await svc.saveDraft(null, { billDate: TODAY, taxMode: "GST", customer: { name: "A" }, items: [{ particulars: "Bricks", quantity: 1 }], notes: "" });
    const err = await svc.finalizeBill(draft.id, toFinalizeRequest(), { today: TODAY }).catch((e) => e);
    expect(err).toBeInstanceOf(BillNotReadyError);
    expect(err.problems.map((p) => p.field)).toEqual(["customer.stateCode", "customer.address", "items.0.unit", "items.0.rate", "items.0.hsn", "items.0.taxRate", "items"]);
    expect(finalizeErrorText(err)).toMatch(/Not ready to finalize: .*\(and 6 more\)/);
    const ok = await svc.saveDraft(null, request());
    expect((await svc.finalizeBill(ok.id, toFinalizeRequest(), { today: TODAY })).billNumber).toMatch(/\/0005$/);
  });
  it("finalize fails when the seller's own details are missing", async () => {
    const svc = createBillService(initialBills, initialInvoiceSettings); // no GSTIN, no address
    const draft = await svc.saveDraft(null, request());
    const err = await svc.finalizeBill(draft.id, toFinalizeRequest(), { today: TODAY }).catch((e) => e);
    expect(err.problems.map((p) => p.field)).toEqual(["seller", "seller.gstin"]);
  });
  it("finalized and cancelled bills cannot be edited, and a draft cannot be cancelled", async () => {
    const svc = fresh();
    const [finalized, cancelled, draft] = [initialBills[0], initialBills[2], initialBills[4]];
    await expect(svc.saveDraft(finalized.id, request())).rejects.toThrow(/Only a draft/);
    await expect(svc.saveDraft(cancelled.id, request())).rejects.toThrow(/Only a draft/);
    await expect(svc.cancelBill(draft.id, { reason: "not needed" })).rejects.toThrow(/Only a finalized bill/);
    await expect(svc.finalizeBill(finalized.id, toFinalizeRequest(), { today: TODAY })).rejects.toThrow(/already finalized/);
  });
  it("cancel needs a reason of at least 3 characters, keeps the number and cannot repeat", async () => {
    const svc = fresh();
    const id = initialBills[0].id;
    await expect(svc.cancelBill(id, { reason: "No" })).rejects.toThrow(/reason/);
    const c = await svc.cancelBill(id, toCancelRequest("Wrong rate used"));
    expect([c.status, c.billNumber, c.cancelledReason]).toEqual(["CANCELLED", initialBills[0].billNumber, "Wrong rate used"]);
    await expect(svc.cancelBill(id, { reason: "again please" })).rejects.toThrow(/Only a finalized bill/);
  });
  it("a cancelled number is never reused", async () => {
    const svc = fresh();
    await svc.cancelBill(initialBills[1].id, { reason: "Duplicate bill" });
    const d = await svc.saveDraft(null, request());
    expect((await svc.finalizeBill(d.id, toFinalizeRequest(), { today: TODAY })).billNumber).toMatch(/\/0005$/);
  });
  it("discarding a draft removes it; a finalized bill cannot be discarded", async () => {
    const svc = fresh();
    await svc.discardDraft(initialBills[4].id);
    expect((await svc.listBills()).some((b) => b.id === initialBills[4].id)).toBe(false);
    await expect(svc.discardDraft(initialBills[0].id)).rejects.toThrow(/Only a draft/);
  });
  it("a stale revision is refused", async () => {
    const svc = fresh();
    const draft = await svc.saveDraft(null, request());
    await expect(svc.saveDraft(draft.id, { ...request(), revision: draft.revision + 5 })).rejects.toThrow(/changed somewhere else/);
    await expect(svc.finalizeBill(draft.id, { reviewed: true, revision: 99 }, { today: TODAY })).rejects.toThrow(/changed somewhere else/);
  });
  it("finalized bills keep the seller details they were finalized with", async () => {
    const svc = fresh();
    const draft = await svc.saveDraft(null, request());
    const done = await svc.finalizeBill(draft.id, toFinalizeRequest(), { today: TODAY });
    await svc.saveSettings({ businessName: "Renamed Co", bank: { bankName: "Other Bank" } });
    const same = (await svc.listBills()).find((b) => b.id === done.id);
    expect(same.seller.businessName).toBe("AAYUSH CARTING");
    expect(same.seller.bank.bankName).toBe("");
    expect((await svc.getSettings()).businessName).toBe("Renamed Co");
  });
  it("rejects invalid settings and normalises valid ones", async () => {
    const svc = fresh();
    await expect(svc.saveSettings({ gstin: "bad" })).rejects.toThrow(/need attention/);
    const saved = await svc.saveSettings(toSettingsRequest({ ...initialInvoiceSettings, gstin: "26abcde1234f1z5", phones: ["98765 43210"] }));
    expect(saved.gstin).toBe("26ABCDE1234F1Z5");
    expect(saved.phones).toEqual(["98765 43210"]);
  });
  it("drafts use the current settings for display; a changed state code changes the derived tax", async () => {
    const svc = fresh();
    const draft = await svc.saveDraft(null, request({ customer: cust({ stateCode: "24" }) }));
    expect(billTotals(draft).taxType).toBe(INTER);
  });
});

describe("invoice PDF", () => {
  const latin1 = (bytes) => new TextDecoder("latin1").decode(bytes);
  const fullSeller = { ...sellerSnapshot(initialInvoiceSettings), gstin: "26ABCDE1234F1Z5", pan: "ABCDE1234F", address: "Test Road, Test Town", phones: ["11111 22222", "33333 44444"], jurisdiction: "Test Jurisdiction", bank: { bankName: "Test Bank", branch: "Main", accountNumber: "123456789012", ifsc: "ABCD0123456" }, proprietorName: "Proprietor" };
  const withSeller = (b) => ({ ...b, seller: fullSeller });
  const many = (n) => withSeller({ ...initialBills[4], items: Array.from({ length: n }, (_, i) => ({ particulars: `Material ${i + 1}`, hsn: "2517", quantity: i + 1, unit: "Tonnes", rate: 100, taxRate: 5 })) });
  it("is a real A4 text PDF with the invoice wording and totals", () => {
    const bill = withSeller(initialBills[0]);
    const s = latin1(buildInvoicePdf(bill));
    expect(s.startsWith("%PDF-1.4")).toBe(true);
    expect(s).toContain("/MediaBox [0 0 595 842]");
    expect(s).toContain("/Count 1");
    const grand = billTotals(bill).grandPaise;
    for (const word of ["TAX INVOICE", "AAYUSH CARTING", bill.billNumber, "Shree Ganesh Constructions", "BANK DETAILS", amountInWords(grand), "ABCD0123456", "Subject to Test Jurisdiction"]) expect(s).toContain(word);
    expect(s).not.toContain("/Subtype /Image");
  });
  it("still draws an invoice when the seller details are not entered yet", () => {
    const s = latin1(buildInvoicePdf(initialBills[0]));
    expect(s).toContain("TAX INVOICE");
    expect(s).toContain("BANK DETAILS");
    expect(s).not.toContain("undefined");
    expect(s).not.toContain("Subject to");
  });
  it("has as many pages as the on-screen invoice, with the footer only on the last", () => {
    for (const n of [5, 18, 19, 40, 90]) {
      const bill = many(n);
      const pages = paginateItems(bill.items).length;
      const s = latin1(buildInvoicePdf(bill));
      expect(s).toContain(`/Count ${pages}`);
      expect(s.split("BANK DETAILS").length - 1).toBe(1);
      expect(s.split("Continued on next page").length - 1).toBe(pages - 1);
    }
  });
  it("marks drafts and cancelled bills, not finalized ones", () => {
    expect(latin1(buildInvoicePdf(initialBills[4]))).toContain("(DRAFT)");
    expect(latin1(buildInvoicePdf(initialBills[2]))).toContain("(CANCELLED)");
    expect(latin1(buildInvoicePdf(initialBills[0]))).not.toContain("(DRAFT)");
  });
  it("prints the tax rows of the derived tax type", () => {
    expect(latin1(buildInvoicePdf(withSeller(initialBills[0])))).toContain("CGST@ 2.5 %");
    expect(latin1(buildInvoicePdf(withSeller(initialBills[1])))).toContain("IGST @ 5 %");
    expect(latin1(buildInvoicePdf(withSeller(initialBills[3])))).not.toContain("GST@");
  });
  it("escapes brackets and replaces letters the standard fonts cannot draw", () => {
    const bill = { ...initialBills[0], customer: { ...initialBills[0].customer, name: "A (B) \\ \u092e\u0930" } };
    expect(latin1(buildInvoicePdf(bill))).toContain("A \\(B\\) \\\\ ??");
  });
  it("builds a safe file name (a draft has no number)", () => {
    expect(invoiceFileName({ billNumber: "AC/2026-27/0001" })).toBe("Tax-Invoice-AC-2026-27-0001.pdf");
    expect(invoiceFileName({ billNumber: null })).toBe("Tax-Invoice-Draft.pdf");
  });
});

describe("invoice formatting", () => {
  it("formats the printed pieces", () => {
    expect(invoiceDate("2026-11-04")).toBe("04-11-2026");
    expect(quantityText({ quantity: 5000, unit: "Bricks" })).toBe("5,000 Bricks");
    expect(quantityText({ quantity: 100000, unit: "Bricks" })).toBe("1,00,000 Bricks");
    expect(quantityText({ quantity: 2.5, unit: "Tonnes" })).toBe("2.5 Tonnes");
    expect(addressParts("Rakholi, House No. 185, Silvassa")).toEqual({ head: "Rakholi", rest: ", House No. 185, Silvassa" });
    expect(addressParts(undefined)).toEqual({ head: "", rest: "" });
    expect(phoneList(["111", " 222 ", ""])).toEqual(["111", "222"]);
    expect(phoneList("111, 222")).toEqual(["111", "222"]);
  });
  it("maps the backend seller names to the invoice layout, blank when missing", () => {
    const { seller, bank } = invoiceSeller({ seller: { businessName: "N", proprietorName: "P", productsLine: "L", bank: { bankName: "B", ifsc: "I" } } });
    expect([seller.name, seller.signatoryTitle, seller.productLine, bank.name, bank.ifsc, bank.branch, seller.gstin]).toEqual(["N", "P", "L", "B", "I", "", ""]);
    expect(invoiceSeller({}).seller.name).toBe("");
  });
  it("shows only the tax rows that apply", () => {
    const items = [row({ quantity: "1", rate: "1000", taxRate: "18" })];
    expect(taxRows(computeInvoice(items, "GST", INTRA)).map((r) => r.label)).toEqual(["CGST@ 9 %", "SGST@ 9 %"]);
    expect(taxRows(computeInvoice(items, "GST", INTER)).map((r) => r.label)).toEqual(["IGST @ 18 %"]);
    expect(taxRows(computeInvoice(items, "NON_GST", INTRA))).toEqual([]);
    expect(taxRows(computeInvoice(items, "GST", null))).toEqual([]);
  });
});

describe("bill form helpers", () => {
  const settings = initialInvoiceSettings;
  it("starts empty with the default invoice type, no number and no assumed tax rate", () => {
    const f = emptyForm({ settings, today: TODAY });
    expect([f.billDate, f.taxMode, f.items.length, f.items[0].taxRate, f.notes]).toEqual([TODAY, "GST", 1, "", ""]);
    expect(f).not.toHaveProperty("number");
  });
  it("round-trips a saved bill, and the signature ignores row keys but sees real changes", () => {
    const bill = initialBills[0];
    const a = formFromBill(bill);
    const b = formFromBill(bill);
    expect(formSignature(a)).toBe(formSignature(b));
    b.customer.name = "Other";
    expect(formSignature(a) === formSignature(b)).toBe(false);
    expect(a.items[0].quantity).toBe("5000");
    expect(formFromBill({ ...bill, items: [{ particulars: "x", hsn: "", quantity: null, unit: "", rate: null, taxRate: null }] }).items[0]).toMatchObject({ quantity: "", rate: "", taxRate: "" });
  });
  it("preview bill uses current settings, has no number and treats unreadable numbers as 0", () => {
    const f = emptyForm({ settings, today: TODAY });
    f.items[0] = { ...f.items[0], particulars: "Bricks", quantity: "abc", unit: "Bricks", rate: "8" };
    const p = previewBillFromForm(f, { ...settings, gstin: "26ABCDE1234F1Z5" });
    expect(p.items[0].quantity).toBe(0);
    expect(p.seller.gstin).toBe("26ABCDE1234F1Z5");
    expect(p.billNumber).toBeNull();
    expect(p.status).toBe("DRAFT");
  });
  it("explains how GST will be applied, from the state codes", () => {
    const f = emptyForm({ settings, today: TODAY });
    f.customer.stateCode = "24";
    expect(taxTypeInfo(f, "26")).toMatchObject({ taxType: INTER, notices: [] });
    f.customer.stateCode = "26";
    expect(taxTypeInfo(f, "26").taxType).toBe(INTRA);
    f.customer.stateCode = "";
    expect(taxTypeInfo(f, "26")).toMatchObject({ taxType: null });
    expect(taxTypeInfo(f, "26").notices[0]).toMatch(/customer's state code/);
    expect(taxTypeInfo(f, "").notices).toHaveLength(2);
    expect(taxTypeInfo({ ...f, taxMode: "NON_GST" }, "").notices).toEqual([]);
  });
  it("warns about letters the PDF cannot draw", () => {
    const f = emptyForm({ settings, today: TODAY });
    f.customer.name = "\u0936\u094d\u0930\u0940";
    expect(nonLatinFields(f)).toEqual(["customer name or address"]);
  });
  it("finalize error text names the first problem", () => {
    expect(finalizeErrorText({ message: "x" })).toBe("x");
    expect(finalizeErrorText({ problems: [{ message: "Customer address is required" }] })).toBe("Not ready to finalize: Customer address is required. Open the draft to fix it.");
  });
});
