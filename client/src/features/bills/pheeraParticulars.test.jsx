// MOCKED / static-markup tests: no real server or database.
// A Pheera line's Particulars is only the material name; truck, destination, date and Pheera number stay in `source` (linked by sourceTripId).
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { initialBills, initialInvoiceSettings } from "../../mock/bills";
import { finalizeProblems, validateBillInput } from "../../validators/billValidator";
import { computeInvoice } from "./billCalculations";
import { fromBillDto, sellerSnapshot, toBillRequest } from "./billContract";
import { MATERIAL_OPTIONS, itemToDraft, materialOf } from "./billModel";
import { buildInvoicePdf } from "./invoicePdf";
import InvoiceDocument from "./InvoiceDocument";
import ItemsEditor from "./ItemsEditor";

const source = (o = {}) => ({ pheeraNo: 1, truckNumber: "ZZ2424936", businessDate: "2026-11-19", materialName: "Bricks", destination: "Test Site", quantity: 25000, unit: "bricks", ...o });
const dtoItem = (o = {}) => ({ particulars: "Bricks", hsn: "6901", quantity: 25000, unit: "bricks", ratePaise: 700000, taxRate: 5, pricingUnit: "PER_THOUSAND", sourceTripId: "t1", source: source(), taxablePaise: 17500000, totalPaise: 18375000, ...o });
const editor = (items) => renderToStaticMarkup(<ItemsEditor items={items.map((it, i) => ({ key: `k${i}`, ...it }))} errors={[]} taxMode="GST" totals={{ lines: [] }} onChange={() => {}} onAdd={() => {}} onRemove={() => {}} />);
// the <option ... selected> inside the Material select, if any
const selectedMaterial = (html) => /<option value="([^"]*)" selected/.exec(html)?.[1] ?? "";
const particularsInput = (html) => /<input[^>]*value="([^"]*)"[^>]*>(?=[\s\S]*?HSN)/.exec(html.slice(html.indexOf("Particulars")))?.[1];

describe("Material dropdown follows Particulars", () => {
  it("materialOf returns the material option that Particulars holds, otherwise nothing", () => {
    for (const m of MATERIAL_OPTIONS) expect(materialOf(m)).toBe(m);
    expect(materialOf("  Bricks ")).toBe("Bricks");
    expect(materialOf("Bricks - Truck ZZ2424936 - to Test Site - 19-11-2026 (Pheera 1)")).toBe("");
    expect(materialOf("Loading charge")).toBe("");
    expect(materialOf("")).toBe("");
    expect(materialOf(undefined)).toBe("");
  });
  it("a Pheera line with Particulars 'Bricks' shows Bricks selected, Particulars 'Bricks' and a read-only quantity from the Pheera", () => {
    const item = itemToDraft(fromBillDto({ ...baseBill(), items: [dtoItem()] }).items[0]);
    const html = editor([item]);
    expect(selectedMaterial(html)).toBe("Bricks");
    expect(html).toMatch(/value="Bricks"[^>]*placeholder="e\.g\. Bricks"|placeholder="e\.g\. Bricks"[^>]*value="Bricks"/);
    expect(html).toContain('value="25000"');
    expect(html).toMatch(/readOnly=""[^>]*value="25000"|value="25000"[^>]*readOnly=""/); // quantity stays locked to the Pheera
    expect(html).toContain("From the Pheera");
    expect(html).toContain("Pheera #1 of ZZ2424936"); // the link to the trip stays visible
  });
  it("a Soil Pheera line selects Soil", () => {
    const item = itemToDraft(fromBillDto({ ...baseBill(), items: [dtoItem({ particulars: "Soil", unit: "tonnes", quantity: 4.5, pricingUnit: "PER_UNIT", source: source({ materialName: "Soil", quantity: 4.5, unit: "tonnes" }) })] }).items[0]);
    expect(selectedMaterial(editor([item]))).toBe("Soil");
  });
  it("Particulars stays editable on a Pheera line, and a manual or edited text selects nothing", () => {
    const edited = { ...itemToDraft(fromBillDto({ ...baseBill(), items: [dtoItem()] }).items[0]), particulars: "Red Bricks (First Class)" };
    const html = editor([edited]);
    expect(selectedMaterial(html)).toBe("");
    expect(html).toContain('value="Red Bricks (First Class)"');
    const particulars = html.slice(html.indexOf("Particulars"), html.indexOf("HSN/SAC"));
    expect(particulars).not.toMatch(/readOnly/);
    const manual = editor([{ particulars: "Loading charge", hsn: "", quantity: "1", unit: "Trip", rate: "", taxRate: "" }]);
    expect(selectedMaterial(manual)).toBe("");
    expect(manual).toContain('value="Loading charge"');
  });
  it("a manual item can still be filled by picking a material (the existing picker behaviour is unchanged)", () => {
    const blank = editor([{ particulars: "", hsn: "", quantity: "", unit: "", rate: "", taxRate: "" }]);
    expect(selectedMaterial(blank)).toBe("");
    expect(blank).toContain("Choose...");
    expect(editor([{ particulars: "Sand", hsn: "", quantity: "", unit: "", rate: "", taxRate: "" }])).toMatch(/<option value="Sand" selected/);
  });
});

const baseBill = () => ({ id: "b1", billNumber: null, status: "DRAFT", billDate: "2026-11-19", customer: { name: "Ram", address: "", gstin: "", stateName: "Maharashtra", stateCode: "27", contact: "" }, customerId: "c1", taxMode: "GST", taxType: "INTRA", taxPending: false, revision: 2, sourceTripIds: ["t1"], tripCount: 1, taxableTotalPaise: 0, grandTotalPaise: 0, notes: "", items: [dtoItem()] });

describe("saving a draft keeps the Pheera link and the owner's text", () => {
  const form = (particulars) => {
    const bill = fromBillDto(baseBill());
    return { billDate: "2026-11-19", customer: bill.customer, taxMode: "GST", notes: "", items: [{ ...itemToDraft(bill.items[0]), particulars }] };
  };
  it("the request carries sourceTripId, particulars 'Bricks', the locked quantity and unit - and no trip text", () => {
    const check = validateBillInput({ ...form("Bricks"), allowedRates: [5] });
    expect(check.valid).toBe(true);
    const req = toBillRequest(check.value, 2);
    expect(req.items[0]).toEqual({ sourceTripId: "t1", particulars: "Bricks", hsn: "6901", quantity: 25000, unit: "bricks", rate: 7000, taxRate: 5 });
    expect(JSON.stringify(req)).not.toMatch(/ZZ2424936|Test Site|Pheera 1/);
  });
  it("a manually edited Particulars is sent as typed, still linked to the Pheera", () => {
    const check = validateBillInput({ ...form("Red Bricks (First Class)"), allowedRates: [5] });
    expect(toBillRequest(check.value, 2).items[0]).toMatchObject({ sourceTripId: "t1", particulars: "Red Bricks (First Class)", quantity: 25000, unit: "bricks" });
  });
  it("an empty Particulars is still allowed in a draft but blocks finalizing (rule unchanged)", () => {
    expect(validateBillInput({ ...form(""), allowedRates: [5] }).valid).toBe(true);
    const bill = { taxMode: "GST", billDate: "2026-11-19", customer: { name: "Ram", address: "x", stateCode: "27" }, items: [{ particulars: "", hsn: "6901", quantity: 1, unit: "bricks", rate: 1, taxRate: 5 }] };
    expect(finalizeProblems(bill, { businessName: "A", address: "x", gstin: "g", stateCode: "27" }, "2026-11-19").map((p) => p.field)).toContain("items.0.particulars");
  });
  it("the source details survive the editor round trip untouched", () => {
    const bill = fromBillDto(baseBill());
    expect(itemToDraft(bill.items[0]).source).toEqual(source());
  });
});

describe("amounts and the invoice preview / PDF are unaffected by the shorter Particulars", () => {
  const bill = () => ({ ...initialBills[4], seller: { ...sellerSnapshot(initialInvoiceSettings), gstin: "26ABCDE1234F1Z5", address: "Test Road, Test Town", phones: ["11111 22222"], jurisdiction: "Test", bank: { bankName: "B", branch: "b", accountNumber: "1", ifsc: "X" } }, items: [{ particulars: "Bricks", hsn: "6901", quantity: 25000, unit: "bricks", rate: 7000, taxRate: 5, pricingUnit: "PER_THOUSAND", sourceTripId: "t1", source: source() }] });
  it("25,000 bricks at Rs 7,000 per 1,000 + 5% GST = the same totals", () => {
    const t = computeInvoice([{ quantity: 25000, rate: 7000, taxRate: 5, pricingUnit: "PER_THOUSAND" }], "GST", "INTRA");
    expect(t.taxablePaise).toBe(17_500_000);
    expect(t.grandPaise).toBe(18_375_000);
  });
  it("the preview shows 'Bricks' in the Particulars column and no trip text", () => {
    const html = renderToStaticMarkup(<InvoiceDocument bill={bill()} />);
    expect(html).toContain("<td>Bricks</td>");
    expect(html).not.toMatch(/ZZ2424936|Test Site|\(Pheera/);
  });
  it("the PDF is generated and contains the material name", () => {
    const text = new TextDecoder("latin1").decode(buildInvoicePdf(bill()));
    expect(text.startsWith("%PDF")).toBe(true);
    expect(text).toContain("Bricks");
  });
  it("an existing bill that already has the long text is shown exactly as saved", () => {
    const OLD = "Bricks - Truck ZZ2424936 - to Test Site - 19-11-2026 (Pheera 1)";
    const old = bill();
    old.items[0].particulars = OLD;
    expect(renderToStaticMarkup(<InvoiceDocument bill={old} />)).toContain(`<td>${OLD}</td>`);
    expect(editor([itemToDraft(fromBillDto({ ...baseBill(), items: [dtoItem({ particulars: OLD })] }).items[0])])).toContain(`value="${OLD}"`);
  });
});
