// MOCKED tests: `fetch` is stubbed (or the service is a fake) and views are static markup. No real server or database.
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../services/api";
import { billApiService } from "../../services/billApiService";
import * as billApi from "../../services/billApi";
import { call, fail, ok, stubFetch } from "../../services/_mockHelpers";
import { toBillRequest } from "./billContract";
import { billTotals, filterBills, summarizeBills } from "./billSelectors";

afterEach(() => vi.unstubAllGlobals());

const listRow = (o = {}) => ({ id: "b1", billNumber: null, status: "DRAFT", billDate: "2026-11-01", customerName: "Ram Builders", customerGstin: "", taxMode: "GST", taxableTotalPaise: 100000, gstPaise: 5000, grandTotalPaise: 105000, itemCount: 1, customerId: null, tripCount: 0, revision: 1, ...o });
const detail = (o = {}) => ({
  ...listRow(), customer: { name: "Ram Builders", address: "Silvassa", gstin: "", stateName: "", stateCode: "26", contact: "" }, taxType: "INTRA", taxPending: false, cgstPaise: 2500, sgstPaise: 2500, igstPaise: 0, notes: "", seller: { businessName: "AC", stateCode: "26" }, history: [],
  items: [{ particulars: "Bricks", hsn: "6901", quantity: 1000, unit: "Bricks", ratePaise: 100, taxRate: 5, taxRateBp: 500, taxablePaise: 100000, cgstPaise: 2500, sgstPaise: 2500, igstPaise: 0, totalPaise: 105000 }], ...o,
});
const settingsDto = () => ({ businessName: "AC", numbering: { prefix: "AC", separator: "/", includeFinancialYear: true, padding: 4 }, defaultTaxMode: "GST", allowedTaxRates: [5, 18], units: ["Bricks"], revision: 2 });
const value = { billDate: "2026-11-01", customer: { name: "Ram", address: "", gstin: "", stateName: "", stateCode: "26", contact: "" }, taxMode: "GST", notes: "", items: [{ particulars: "Bricks", hsn: "6901", quantity: 1000, unit: "Bricks", rate: 1, taxRate: 5 }] };

describe("bills list from the server", () => {
  it("reads every page (limit 100) and checks the total; rows carry customer, number, date, status and the server's totals", async () => {
    const f = stubFetch();
    const rows = Array.from({ length: 150 }, (_, i) => listRow({ id: `b${i}` }));
    f.mockResolvedValueOnce(ok(rows.slice(0, 100), { page: 1, limit: 100, total: 150 })).mockResolvedValueOnce(ok(rows.slice(100), { page: 2, limit: 100, total: 150 }));
    const list = await billApi.fetchAllBills();
    expect(list).toHaveLength(150);
    expect(call(f, 0).query).toMatchObject({ page: "1", limit: "100" });
    expect(call(f, 1).query).toMatchObject({ page: "2" });
    expect(list[0]).toMatchObject({ listOnly: true, customer: { name: "Ram Builders" }, grandTotalPaise: 105000 });
  });
  it("a partial list is never returned (the total does not add up twice)", async () => {
    const f = stubFetch();
    f.mockImplementation(async () => ok([listRow()], { page: 1, limit: 100, total: 2 }));
    await expect(billApi.fetchAllBills()).rejects.toThrow(/changed while/);
  });
  it("list rows show the SERVER totals and the summary counts only finalized bills", () => {
    const rows = [listRow(), listRow({ id: "b2", status: "FINALIZED", billNumber: "0001", grandTotalPaise: 200000 }), listRow({ id: "b3", status: "CANCELLED", billNumber: "0002", grandTotalPaise: 999 })].map((r) => ({ ...r, listOnly: true, customer: { name: r.customerName, gstin: "" }, items: [] }));
    expect(billTotals(rows[0])).toMatchObject({ taxablePaise: 100000, taxPaise: 5000, grandPaise: 105000 });
    expect(summarizeBills(rows)).toMatchObject({ draft: 1, finalized: 1, cancelled: 1, invoicedPaise: 200000 });
    expect(filterBills(rows, { search: "0001" })).toHaveLength(1);
    expect(filterBills(rows, { status: "DRAFT", search: "ram" })).toHaveLength(1);
  });
  it("detail totals come from the server, not from a client calculation", async () => {
    const f = stubFetch();
    f.mockResolvedValueOnce(ok(detail({ grandTotalPaise: 777 })));
    const bill = await billApi.getBill("b1");
    expect(billTotals(bill).grandPaise).toBe(777);
    expect(bill.items[0]).toMatchObject({ rate: 1, ratePaise: 100, taxablePaise: 100000 });
  });
});

describe("manual bill create / edit (revision) / finalize / cancel / discard", () => {
  it("create posts the strict request shape (no totals, status, number) and returns the server's draft", async () => {
    const f = stubFetch();
    f.mockResolvedValueOnce(ok(detail(), undefined, 201));
    const bill = await billApiService.saveDraft(null, toBillRequest(value));
    const c = call(f);
    expect(c).toMatchObject({ method: "POST", path: "/api/bills" });
    expect(Object.keys(c.body).sort()).toEqual(["billDate", "customer", "items", "notes", "taxMode"]);
    expect(c.body.items[0]).toEqual({ particulars: "Bricks", hsn: "6901", quantity: 1000, unit: "Bricks", rate: 1, taxRate: 5 });
    expect(bill).toMatchObject({ id: "b1", revision: 1 });
  });
  it("update sends the revision; a stale revision (409) is refused and leaves the typed data to the screen", async () => {
    const f = stubFetch();
    f.mockResolvedValueOnce(fail(409, "This draft was changed by someone else. Reload and try again"));
    await expect(billApiService.saveDraft("b1", toBillRequest(value, 3))).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/changed by someone else/) });
    expect(call(f)).toMatchObject({ method: "PATCH", path: "/api/bills/b1", body: { revision: 3 } });
  });
  it("a validation error (400) keeps the server's field list", async () => {
    const f = stubFetch();
    f.mockResolvedValueOnce(fail(400, "Validation failed", [{ field: "items.0.rate", message: "Rate is too large" }]));
    await expect(billApiService.saveDraft(null, toBillRequest(value))).rejects.toMatchObject({ status: 400, errors: [{ field: "items.0.rate" }] });
  });
  it("finalize sends reviewed:true + revision; HSN / tax problems come back as error.problems", async () => {
    const f = stubFetch();
    f.mockResolvedValueOnce(fail(400, "This bill is not ready to finalize", [{ field: "items.0.hsn", message: "HSN/SAC code is required on a GST bill" }]));
    await expect(billApiService.finalizeBill("b1", { revision: 2 })).rejects.toMatchObject({ problems: [{ field: "items.0.hsn", message: "HSN/SAC code is required on a GST bill" }] });
    expect(call(f)).toMatchObject({ method: "POST", path: "/api/bills/b1/finalize", body: { reviewed: true, revision: 2 } });
  });
  it("finalize shows the server's number only from the server's answer", async () => {
    const f = stubFetch();
    f.mockResolvedValueOnce(ok(detail({ status: "FINALIZED", billNumber: "AC/2026-27/0001", revision: 3 })));
    expect(await billApiService.finalizeBill("b1", { revision: 2 })).toMatchObject({ status: "FINALIZED", billNumber: "AC/2026-27/0001" });
  });
  it("cancel needs a reason and keeps the bill; discard is a POST (never a DELETE)", async () => {
    const f = stubFetch();
    f.mockResolvedValueOnce(ok(detail({ status: "CANCELLED", billNumber: "0001", cancelledReason: "Wrong customer" }))).mockResolvedValueOnce(ok({ id: "b2" }));
    const bill = await billApiService.cancelBill("b1", { reason: " Wrong customer " });
    await billApiService.discardDraft("b2");
    expect(call(f, 0)).toMatchObject({ method: "POST", path: "/api/bills/b1/cancel", body: { reason: "Wrong customer" } });
    expect(call(f, 1)).toMatchObject({ method: "POST", path: "/api/bills/b2/discard" });
    expect(bill).toMatchObject({ status: "CANCELLED", cancelledReason: "Wrong customer" });
  });
  it("a finalized-bill refusal (409) arrives as the server wrote it", async () => {
    const f = stubFetch();
    f.mockResolvedValueOnce(fail(409, "Bill 0001 is finalized and can no longer be edited. Cancel it and issue a new bill instead"));
    await expect(billApiService.saveDraft("b1", toBillRequest(value, 2))).rejects.toThrow(/can no longer be edited/);
  });
  it("never calls the Pheera-to-Bill endpoints", async () => {
    const f = stubFetch();
    f.mockImplementation(async () => ok(detail()));
    await billApiService.saveDraft(null, toBillRequest(value));
    await billApiService.saveDraft("b1", toBillRequest(value, 1));
    await billApiService.finalizeBill("b1", { revision: 1 });
    expect(f.mock.calls.map(([url]) => url).join(" ")).not.toMatch(/from-trips|\/trips/);
  });
});

describe("invoice settings", () => {
  it("reads the server's values and saves via PATCH /invoice-settings with the strict shape; the server's answer is what is shown", async () => {
    const f = stubFetch();
    f.mockResolvedValueOnce(ok(settingsDto())).mockResolvedValueOnce(ok({ ...settingsDto(), gstin: "26AABCS1234F1Z5", revision: 3 }));
    expect((await billApiService.getSettings()).numbering.prefix).toBe("AC");
    const saved = await billApiService.saveSettings({ businessName: " AC ", gstin: "26aabcs1234f1z5", numbering: { prefix: "AC", separator: "/", includeFinancialYear: true, padding: 4 }, allowedTaxRates: ["5"], units: ["Bricks"], phones: [], bank: {}, defaultTaxMode: "GST" });
    const c = call(f, 1);
    expect(c).toMatchObject({ method: "PATCH", path: "/api/invoice-settings", body: { businessName: "AC", gstin: "26AABCS1234F1Z5", allowedTaxRates: [5] } });
    expect(c.body).not.toHaveProperty("revision");
    expect(saved).toMatchObject({ gstin: "26AABCS1234F1Z5", revision: 3 });
  });
  it("a server refusal keeps its field message (GSTIN vs state code)", async () => {
    const f = stubFetch();
    f.mockResolvedValueOnce(fail(400, "Validation failed", [{ field: "stateCode", message: "The first 2 digits of the GSTIN must match the state code" }]));
    await expect(billApiService.saveSettings({ numbering: {} })).rejects.toMatchObject({ errors: [{ field: "stateCode" }] });
  });
  it("a non-owner is refused (403) and the message is kept", async () => {
    const f = stubFetch();
    f.mockResolvedValueOnce(fail(403, "You do not have permission to do this"));
    await expect(billApiService.getSettings()).rejects.toMatchObject({ status: 403 });
  });
});

describe("historical compatibility", () => {
  it("an older finalized bill without optional fields (no notes, no seller, missing customer parts, null tax) reads safely", async () => {
    const f = stubFetch();
    f.mockResolvedValueOnce(ok({ ...detail({ status: "FINALIZED", billNumber: "0001" }), notes: undefined, seller: undefined, customer: { name: "Old" }, items: [{ particulars: "Soil", quantity: 2, unit: "Tonnes", ratePaise: 70000, taxRate: null, taxablePaise: 140000, cgstPaise: 0, sgstPaise: 0, igstPaise: 0, totalPaise: 140000 }] }));
    const bill = await billApi.getBill("b1");
    expect(bill).toMatchObject({ notes: "", seller: null, customer: { name: "Old", address: "", stateCode: "" } });
    expect(bill.items[0]).toMatchObject({ hsn: "", taxRate: null, rate: 700 });
    expect(billTotals(bill).grandPaise).toBe(105000);
  });
  it("an ApiError from a lost connection is recognised as unsure by the context's change()", () => {
    expect(new ApiError("Network", { code: "NETWORK" }).isConnectionProblem).toBe(true);
  });
});

import { runBillChange } from "./billChange";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import BillsTable from "./BillsTable";

describe("write then re-read", () => {
  it("success re-reads once; a refusal does not; an unsure outcome re-reads and still throws", async () => {
    const refresh = vi.fn().mockResolvedValue();
    expect(await runBillChange(async () => "saved", refresh)).toBe("saved");
    expect(refresh).toHaveBeenCalledTimes(1);
    refresh.mockClear();
    await expect(runBillChange(async () => { throw new ApiError("Locked", { status: 409 }); }, refresh)).rejects.toThrow("Locked");
    expect(refresh).not.toHaveBeenCalled();
    await expect(runBillChange(async () => { throw new ApiError("Network", { code: "NETWORK" }); }, refresh)).rejects.toThrow("Network");
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});

describe("bills table with server list rows (static markup)", () => {
  it("shows number or Draft, customer, status and the server's amounts without any items", () => {
    const rows = [listRow(), listRow({ id: "b2", status: "FINALIZED", billNumber: "AC/0001", customerGstin: "26AABCS1234F1Z5" })].map((r) => ({ ...r, listOnly: true, customer: { name: r.customerName, gstin: r.customerGstin }, items: [] }));
    const html = renderToStaticMarkup(<MemoryRouter><BillsTable bills={rows} onView={() => {}} onEdit={() => {}} onPrint={() => {}} onDownload={() => {}} onFinalize={() => {}} onCancel={() => {}} /></MemoryRouter>);
    for (const t of ["Draft", "AC/0001", "Ram Builders", "GSTIN 26AABCS1234F1Z5", "1,050.00", "Finalized"]) expect(html).toContain(t);
  });
});
