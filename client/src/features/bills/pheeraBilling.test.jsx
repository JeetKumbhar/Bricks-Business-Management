// MOCKED tests: `fetch` is stubbed / deps are fakes / views are static markup. No real server or database.
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../services/api";
import { generateBillFromPheeras } from "../../services/billApi";
import { call, fail, ok, stubFetch } from "../../services/_mockHelpers";
import { fromPheeraDto } from "../../services/pheeraMapper";
import { runGenerate } from "./generateFlow";
import PheeraPicker from "./PheeraPicker";
import { checkSelection, isOfferable, newRequestId, reconcileGenerate, selectionSummary } from "./pheeraBilling";

afterEach(() => vi.unstubAllGlobals());

const rec = (o = {}) => ({ id: "t1", truckRegistration: "MH12AB1234", businessDate: "2026-11-01", pheeraNumber: 1, material: "Bricks", quantity: 1000, unit: "bricks", destination: "Pune", customerId: "c1", customerName: "Ram", billingStatus: "UNBILLED", isVoided: false, isDeleted: false, bill: null, ...o });
const tripDto = (o = {}) => ({ id: "t1", truckId: "tr1", truckNumber: "MH12AB1234", businessDate: "2026-11-01", pheeraNo: 1, materialCategory: "BRICKS", materialName: "Bricks", quantity: 1000, unit: "bricks", destination: "Pune", customer: { id: "c1", name: "Ram" }, billingStatus: "RESERVED", bill: { id: "b1", billNumber: null, status: "DRAFT" }, isVoided: false, ...o });
const billDto = (o = {}) => ({ id: "b1", billNumber: null, status: "DRAFT", billDate: "2026-11-01", customer: { name: "Ram" }, customerId: "c1", taxMode: "GST", taxType: null, taxPending: true, revision: 1, sourceTripIds: ["t1"], tripCount: 1, taxableTotalPaise: 0, grandTotalPaise: 0, items: [{ particulars: "Bricks - Truck MH12AB1234 - to Pune - 01-11-2026 (Pheera 1)", hsn: "", quantity: 1000, unit: "bricks", ratePaise: 0, taxRate: null, pricingUnit: "PER_THOUSAND", sourceTripId: "t1", taxablePaise: 0, totalPaise: 0 }], trips: [tripDto()], ...o });

describe("selection rules (screen side; the server re-checks everything)", () => {
  const offered = [rec(), rec({ id: "t2", pheeraNumber: 2 }), rec({ id: "t3", customerId: "c2", customerName: "Sita" }), rec({ id: "t4", billingStatus: "RESERVED" }), rec({ id: "t5", billingStatus: null, customerId: null }), rec({ id: "t6", billingStatus: "NOT_BILLABLE", customerId: "i1" }), rec({ id: "t7", isVoided: true })];
  it("only UNBILLED, non-voided Pheeras with a customer are offerable (null, reserved, billed, internal, voided are not)", () => {
    expect(offered.map(isOfferable)).toEqual([true, true, true, false, false, false, false]);
    expect(isOfferable(rec({ billingStatus: "BILLED" }))).toBe(false);
  });
  it("an empty selection is refused before anything is sent", () => expect(checkSelection([], offered)).toMatchObject({ ok: false, problem: "Select at least one Pheera" }));
  it("two customers can never be mixed", () => expect(checkSelection(["t1", "t3"], offered)).toMatchObject({ ok: false, problem: expect.stringMatching(/different customers/) }));
  it("a Pheera that is not offered (reserved / unknown) blocks the selection", () => {
    expect(checkSelection(["t1", "t4"], offered)).toMatchObject({ ok: false, problem: expect.stringMatching(/cannot be billed/) });
    expect(checkSelection(["t1", "zzz"], offered)).toMatchObject({ ok: false, problem: expect.stringMatching(/no longer in the list/) });
  });
  it("a valid selection reports its customer; units are never added together", () => {
    expect(checkSelection(["t1", "t2"], offered)).toMatchObject({ ok: true, customerId: "c1" });
    expect(selectionSummary([rec({ quantity: 1500 }), rec({ quantity: 500 }), rec({ unit: "tonnes", quantity: 4.5 }), rec({ unit: "tonnes", quantity: 0.1 }), rec({ unit: "tonnes", quantity: 0.2 })])).toEqual({ count: 5, bricks: 2000, tonnes: 4.8 });
  });
  it("request ids match the server's pattern", () => {
    expect(newRequestId()).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
    expect(newRequestId()).not.toBe(newRequestId());
  });
});

describe("POST /bills/from-trips (real billApi over a stubbed fetch)", () => {
  it("sends only tripIds + requestId and returns the SERVER's bill, lines, totals and reserved Pheeras", async () => {
    const f = stubFetch();
    f.mockResolvedValueOnce(ok(billDto(), { duplicate: false }, 201));
    const r = await generateBillFromPheeras({ tripIds: ["t1"], requestId: "req-12345678" });
    expect(call(f)).toMatchObject({ method: "POST", path: "/api/bills/from-trips", body: { tripIds: ["t1"], requestId: "req-12345678" } });
    expect(Object.keys(call(f).body).sort()).toEqual(["requestId", "tripIds"]);
    expect(r.duplicate).toBe(false);
    expect(r.bill).toMatchObject({ id: "b1", status: "DRAFT", customerId: "c1", sourceTripIds: ["t1"] });
    expect(r.bill.items[0]).toMatchObject({ sourceTripId: "t1", pricingUnit: "PER_THOUSAND", rate: 0 });
    expect(r.trips[0]).toMatchObject({ billingStatus: "RESERVED", pheeraNumber: 1, bill: { id: "b1" } });
  });
  it("an 'already made' answer for the same requestId is shown as the same draft (duplicate)", async () => {
    const f = stubFetch();
    f.mockResolvedValueOnce(ok(billDto(), { duplicate: true }));
    expect((await generateBillFromPheeras({ tripIds: ["t1"], requestId: "req-12345678" })).duplicate).toBe(true);
  });
});

describe("one attempt end to end (fake deps)", () => {
  const attempt = { requestId: "req-12345678", tripIds: ["t1", "t2"] };
  it("created", async () => {
    const generate = vi.fn().mockResolvedValue({ bill: { id: "b1" }, trips: [], duplicate: false });
    expect(await runGenerate({ attempt, customerId: "c1" }, { generate, readPheeras: vi.fn() })).toMatchObject({ kind: "created", bill: { id: "b1" } });
    expect(generate).toHaveBeenCalledWith({ tripIds: ["t1", "t2"], requestId: "req-12345678" });
  });
  it("a server refusal (409 taken by another draft) says NOTHING was created and lists the server's problems; no re-read, no retry", async () => {
    const generate = vi.fn().mockRejectedValue(new ApiError("Some Pheeras cannot be billed", { status: 409, errors: [{ field: "tripIds", message: "Pheera 2 of MH12AB1234 on 2026-11-01 is already in a draft bill" }] }));
    const readPheeras = vi.fn();
    const out = await runGenerate({ attempt, customerId: "c1" }, { generate, readPheeras });
    expect(out).toEqual({ kind: "refused", message: "Some Pheeras cannot be billed", problems: ["Pheera 2 of MH12AB1234 on 2026-11-01 is already in a draft bill"] });
    expect(generate).toHaveBeenCalledTimes(1);
    expect(readPheeras).not.toHaveBeenCalled();
  });
  it("different customers refused by the server (409) is shown as refused", async () => {
    const generate = vi.fn().mockRejectedValue(new ApiError("Pheeras of different customers cannot be on one bill", { status: 409 }));
    expect(await runGenerate({ attempt, customerId: "c1" }, { generate, readPheeras: vi.fn() })).toMatchObject({ kind: "refused", message: /different customers/ });
  });
  it("a lost connection is NOT reported as failed: the Pheeras are read again — all reserved by one draft = confirmed", async () => {
    const generate = vi.fn().mockRejectedValue(new ApiError("Network", { code: "NETWORK" }));
    const readPheeras = vi.fn().mockResolvedValue([rec({ id: "t1", billingStatus: "RESERVED", bill: { id: "b9" } }), rec({ id: "t2", billingStatus: "RESERVED", bill: { id: "b9" } })]);
    expect(await runGenerate({ attempt, customerId: "c1" }, { generate, readPheeras })).toMatchObject({ kind: "confirmed", billId: "b9" });
    expect(generate).toHaveBeenCalledTimes(1); // never sent again by itself
  });
  it("unsure, and the re-read shows all still UNBILLED = not_applied (the same requestId may be sent again)", async () => {
    const generate = vi.fn().mockRejectedValue(new ApiError("Boom", { status: 500 }));
    const readPheeras = vi.fn().mockResolvedValue([rec({ id: "t1" }), rec({ id: "t2" })]);
    expect(await runGenerate({ attempt, customerId: "c1" }, { generate, readPheeras })).toMatchObject({ kind: "not_applied" });
  });
  it("unsure and the re-read also fails, or the states are mixed = unconfirmed (nothing may be sent again)", async () => {
    const generate = vi.fn().mockRejectedValue(new ApiError("Timeout", { code: "TIMEOUT" }));
    expect(await runGenerate({ attempt, customerId: "c1" }, { generate, readPheeras: vi.fn().mockRejectedValue(new Error("down")) })).toMatchObject({ kind: "unconfirmed" });
    expect(await runGenerate({ attempt, customerId: "c1" }, { generate, readPheeras: vi.fn().mockResolvedValue([rec({ id: "t1" }), rec({ id: "t2", billingStatus: "RESERVED", bill: { id: "b9" } })]) })).toMatchObject({ kind: "unconfirmed" });
  });
  it("reconcile: a Pheera missing from the re-read, or reserved by two different drafts, is unconfirmed", () => {
    expect(reconcileGenerate(["t1", "t2"], [rec({ id: "t1" })]).status).toBe("unconfirmed");
    expect(reconcileGenerate(["t1", "t2"], [rec({ id: "t1", billingStatus: "RESERVED", bill: { id: "a" } }), rec({ id: "t2", billingStatus: "RESERVED", bill: { id: "b" } })]).status).toBe("unconfirmed");
  });
  it("preserves number, quantity, material and customer exactly as the server sent them", () => {
    expect(fromPheeraDto(tripDto({ pheeraNo: 7, quantity: 4.5, unit: "tonnes", materialCategory: "OTHER", materialName: "Khadi Matti" }))).toMatchObject({ pheeraNumber: 7, quantity: 4.5, unit: "tonnes", material: "Khadi Matti", customerId: "c1", customerName: "Ram" });
  });
});

describe("Pheera picker (static markup)", () => {
  it("lists the offered Pheeras with checkboxes and marks the selected ones", () => {
    const html = renderToStaticMarkup(<PheeraPicker rows={[rec(), rec({ id: "t2", pheeraNumber: 2 })]} selected={["t2"]} onToggle={() => {}} onToggleAll={() => {}} />);
    expect(html).toContain("Select all Pheeras");
    expect(html).toContain("Select Pheera 1 of MH12AB1234");
    expect(html).toContain("1,000 bricks");
    expect((html.match(/checked=""/g) ?? []).length).toBeGreaterThanOrEqual(1);
  });
  it("shows an empty state, and disables every checkbox while a request is running", () => {
    expect(renderToStaticMarkup(<PheeraPicker rows={[]} selected={[]} onToggle={() => {}} onToggleAll={() => {}} />)).toContain("No unbilled Pheeras");
    expect(renderToStaticMarkup(<PheeraPicker rows={[rec()]} selected={[]} onToggle={() => {}} onToggleAll={() => {}} disabled />)).toContain('disabled=""');
  });
});

describe("server refusal shapes", () => {
  it("a 404 / 403 from the stub keeps the server's message", async () => {
    const f = stubFetch();
    f.mockResolvedValueOnce(fail(403, "You do not have permission to do this"));
    await expect(generateBillFromPheeras({ tripIds: ["t1"], requestId: "req-12345678" })).rejects.toMatchObject({ status: 403 });
  });
});
