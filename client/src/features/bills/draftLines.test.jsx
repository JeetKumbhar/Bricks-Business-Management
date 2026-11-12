// MOCKED tests: stubbed fetch / fake deps / static markup. No real server or database.
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../services/api";
import { addPheerasToBill, getBillTrips, removePheeraFromBill } from "../../services/billApi";
import { call, fail, ok, stubFetch } from "../../services/_mockHelpers";
import { computeInvoice, lineAmountPaise } from "./billCalculations";
import { fromBillDto, toBillRequest } from "./billContract";
import { itemToDraft } from "./billModel";
import { runAddPheeras, runRemovePheera } from "./draftLineFlow";
import { canAddPheeras, canRemovePheera, reconcileAdd, reconcileRemove } from "./pheeraBilling";
import { validateBillInput } from "../../validators/billValidator";
import ItemsEditor from "./ItemsEditor";
import BillPheeraPanel from "./BillPheeraPanel";
import AddPheerasModal from "./AddPheerasModal";

vi.mock("../../components/ui/Modal", () => ({ default: ({ open, title, children, footer }) => (open ? <section><h2>{title}</h2>{children}<footer>{footer}</footer></section> : null) }));
afterEach(() => vi.unstubAllGlobals());

const tripDto = (o = {}) => ({ id: "t1", truckId: "tr1", truckNumber: "MH12AB1234", businessDate: "2026-11-01", pheeraNo: 1, materialCategory: "BRICKS", materialName: "Bricks", quantity: 1000, unit: "bricks", destination: "Pune", customer: { id: "c1", name: "Ram" }, billingStatus: "RESERVED", bill: { id: "b1", billNumber: null, status: "DRAFT" }, isVoided: false, ...o });
const itemDto = (o = {}) => ({ particulars: "Bricks - Truck MH12AB1234 (Pheera 1)", hsn: "", quantity: 1000, unit: "bricks", ratePaise: 0, taxRate: null, pricingUnit: "PER_THOUSAND", sourceTripId: "t1", source: { pheeraNo: 1, truckNumber: "MH12AB1234" }, taxablePaise: 0, totalPaise: 0, ...o });
const billDto = (o = {}) => ({ id: "b1", billNumber: null, status: "DRAFT", billDate: "2026-11-01", customer: { name: "Ram", address: "", gstin: "", stateName: "", stateCode: "26", contact: "" }, customerId: "c1", taxMode: "GST", taxType: "INTRA", taxPending: false, revision: 2, sourceTripIds: ["t1"], tripCount: 1, taxableTotalPaise: 0, grandTotalPaise: 0, notes: "", items: [itemDto()], trips: [tripDto()], ...o });

describe("bricks lines are priced per 1,000 (client preview mirrors the server)", () => {
  it("1,000 bricks at Rs 5,500 per 1,000 = Rs 5,500; 1,250 bricks = Rs 6,875; per-unit lines are unchanged", () => {
    expect(lineAmountPaise(1000, 5500, "PER_THOUSAND")).toBe(550000);
    expect(lineAmountPaise(1250, "5500", "PER_THOUSAND")).toBe(687500);
    expect(lineAmountPaise(2, 700)).toBe(140000);
    expect(lineAmountPaise(2, 700, "PER_UNIT")).toBe(140000);
  });
  it("a Pheera line and a manual line total together with per-line GST", () => {
    const t = computeInvoice([{ quantity: 1000, rate: 5500, taxRate: 5, pricingUnit: "PER_THOUSAND" }, { quantity: 2, rate: 700, taxRate: 5 }], "GST", "INTRA");
    expect(t.taxablePaise).toBe(690000);
    expect(t.cgstPaise + t.sgstPaise).toBe(34500);
    expect(t.grandPaise).toBe(724500);
  });
});

describe("a Pheera line survives the editor round trip", () => {
  const bill = fromBillDto(billDto());
  it("is read with its link, pricing unit and source; a stored rate of 0 shows blank", () => {
    expect(bill.items[0]).toMatchObject({ sourceTripId: "t1", pricingUnit: "PER_THOUSAND" });
    expect(itemToDraft(bill.items[0])).toMatchObject({ sourceTripId: "t1", pricingUnit: "PER_THOUSAND", rate: "", quantity: "1000", unit: "bricks" });
  });
  it("is sent back with sourceTripId (so the server keeps it) and the same quantity and unit", () => {
    const form = { billDate: "2026-11-01", customer: bill.customer, taxMode: "GST", notes: "", items: [{ ...itemToDraft(bill.items[0]), hsn: "6901", rate: "5500", taxRate: "5" }, { particulars: "Delivery", hsn: "9965", quantity: "1", unit: "Trip", rate: "500", taxRate: "5" }] };
    const check = validateBillInput({ ...form, allowedRates: [5] });
    expect(check.valid).toBe(true);
    const req = toBillRequest(check.value, 2);
    expect(req.items[0]).toEqual({ sourceTripId: "t1", particulars: "Bricks - Truck MH12AB1234 (Pheera 1)", hsn: "6901", quantity: 1000, unit: "bricks", rate: 5500, taxRate: 5 });
    expect(req.items[1]).not.toHaveProperty("sourceTripId");
    expect(req.revision).toBe(2);
    expect(Object.keys(req.items[0])).not.toContain("pricingUnit");
  });
  it("the editor shows Pheera lines read-only with no Remove button, and a per-1,000 rate label", () => {
    const items = [{ key: "a", ...itemToDraft(bill.items[0]) }, { key: "b", particulars: "Delivery", hsn: "", quantity: "1", unit: "Trip", rate: "", taxRate: "" }];
    const html = renderToStaticMarkup(<ItemsEditor items={items} errors={[]} taxMode="GST" totals={{ lines: [] }} onChange={() => {}} onAdd={() => {}} onRemove={() => {}} />);
    expect(html).toContain("Rate (Rs per 1,000)");
    expect(html).toContain("Pheera #1 of MH12AB1234");
    expect(html).toContain("Remove it from the bill page");
    expect(html).toContain('readOnly=""');
    expect((html.match(/aria-label="Remove item/g) ?? []).length).toBe(1); // only the manual line
  });
});

describe("add / remove endpoints (real billApi over a stubbed fetch)", () => {
  it("add sends tripIds + the draft's revision and returns the server's bill, lines and reserved Pheeras", async () => {
    const f = stubFetch();
    f.mockResolvedValueOnce(ok(billDto({ revision: 3, sourceTripIds: ["t1", "t2"], items: [itemDto(), itemDto({ sourceTripId: "t2" })], trips: [tripDto(), tripDto({ id: "t2", pheeraNo: 2 })] })));
    const r = await addPheerasToBill("b1", ["t2"], 2);
    expect(call(f)).toMatchObject({ method: "POST", path: "/api/bills/b1/trips", body: { tripIds: ["t2"], revision: 2 } });
    expect(r.bill).toMatchObject({ revision: 3, sourceTripIds: ["t1", "t2"] });
    expect(r.trips.map((t) => t.pheeraNumber)).toEqual([1, 2]);
  });
  it("remove is DELETE /bills/:id/trips/:tripId (one Pheera) and the Pheera comes back from the server", async () => {
    const f = stubFetch();
    f.mockResolvedValueOnce(ok(billDto({ revision: 3, sourceTripIds: [], items: [], tripCount: 0, trips: [] })));
    const r = await removePheeraFromBill("b1", "t1");
    expect(call(f)).toMatchObject({ method: "DELETE", path: "/api/bills/b1/trips/t1" });
    expect(r.bill.sourceTripIds).toEqual([]);
  });
  it("reads the Pheeras of a bill with their status (no status is invented)", async () => {
    const f = stubFetch();
    f.mockResolvedValueOnce(ok([tripDto(), tripDto({ id: "t2", billingStatus: null })]));
    const rows = await getBillTrips("b1");
    expect(call(f)).toMatchObject({ method: "GET", path: "/api/bills/b1/trips" });
    expect(rows.map((r) => r.billingStatus)).toEqual(["RESERVED", null]);
  });
});

describe("what the screen offers", () => {
  it("add: only a DRAFT linked to a saved customer; remove: only a DRAFT", () => {
    expect(canAddPheeras({ status: "DRAFT", customerId: "c1" })).toBe(true);
    expect(canAddPheeras({ status: "DRAFT", customerId: null })).toBe(false);
    expect(canAddPheeras({ status: "FINALIZED", customerId: "c1" })).toBe(false);
    expect(canAddPheeras({ status: "CANCELLED", customerId: "c1" })).toBe(false);
    expect(canRemovePheera({ status: "DRAFT" })).toBe(true);
    expect(canRemovePheera({ status: "FINALIZED" })).toBe(false);
    expect(canRemovePheera({ status: "CANCELLED" })).toBe(false);
  });
  const panel = (bill) => renderToStaticMarkup(<BillPheeraPanel bill={bill} />);
  it("a finalized bill shows its Pheeras read-only: no Add button, no Remove", () => {
    const html = panel({ ...fromBillDto(billDto({ status: "FINALIZED", billNumber: "0001" })), sourceTripIds: ["t1"] });
    expect(html).toContain("Read-only");
    expect(html).not.toContain("Add Pheeras");
  });
  it("a draft linked to a customer offers Add Pheeras; an unlinked draft explains why not", () => {
    expect(panel(fromBillDto(billDto()))).toContain("Add Pheeras");
    const unlinked = panel({ ...fromBillDto(billDto({ customerId: null })), sourceTripIds: [], tripCount: 0 });
    expect(unlinked).toContain("not linked to a saved customer");
    expect(unlinked).toContain('disabled=""');
  });
  it("the add dialog lists only what the server offered and keeps nothing ticked that vanished", () => {
    const rows = [{ id: "t2", truckRegistration: "MH12AB1234", businessDate: "2026-11-02", pheeraNumber: 2, material: "Bricks", quantity: 500, unit: "bricks", destination: "Pune", customerId: "c1", billingStatus: "UNBILLED" }];
    const html = renderToStaticMarkup(<AddPheerasModal open customerName="Ram" rows={rows} loading={false} loadError={null} onReload={() => {}} busy={false} onAdd={() => {}} onClose={() => {}} />);
    expect(html).toContain("Add Pheeras");
    expect(html).toContain("Select Pheera 2 of MH12AB1234");
    expect(html).toContain("Add  to draft");
  });
});

describe("one add / remove end to end (fake deps)", () => {
  const state = (ids) => ({ bill: { id: "b1", sourceTripIds: ids, revision: 4 }, trips: ids.map((id) => ({ id })) });
  it("done: the server's new state is used", async () => {
    const deps = { add: vi.fn().mockResolvedValue(state(["t1", "t2"])), remove: vi.fn(), readState: vi.fn() };
    expect(await runAddPheeras({ billId: "b1", tripIds: ["t2"], revision: 3 }, deps)).toMatchObject({ kind: "done", bill: { revision: 4 } });
    expect(deps.add).toHaveBeenCalledWith("b1", ["t2"], 3);
  });
  it("409 stale revision / taken Pheera: refused, nothing changed, the conflict is flagged, nothing is repeated", async () => {
    const deps = { add: vi.fn().mockRejectedValue(new ApiError("This draft was changed by someone else. Reload and try again", { status: 409 })), remove: vi.fn(), readState: vi.fn() };
    const out = await runAddPheeras({ billId: "b1", tripIds: ["t2"], revision: 1 }, deps);
    expect(out).toMatchObject({ kind: "refused", conflict: true, message: /changed by someone else/ });
    expect(deps.add).toHaveBeenCalledTimes(1);
    expect(deps.readState).not.toHaveBeenCalled();
  });
  it("a finalized-bill refusal and a wrong-customer refusal arrive as the server wrote them", async () => {
    const deps = { add: vi.fn().mockRejectedValue(new ApiError("Only a draft bill can be changed", { status: 409, errors: [{ field: "tripIds", message: "Pheera 2 belongs to another customer" }] })), remove: vi.fn(), readState: vi.fn() };
    expect(await runAddPheeras({ billId: "b1", tripIds: ["t2"], revision: 1 }, deps)).toMatchObject({ kind: "refused", problems: ["Pheera 2 belongs to another customer"] });
  });
  it("unsure add: the draft is read again, never re-sent: confirmed / not_applied / unconfirmed", async () => {
    const lost = new ApiError("Network", { code: "NETWORK" });
    const mk = (readState) => ({ add: vi.fn().mockRejectedValue(lost), remove: vi.fn(), readState });
    expect(await runAddPheeras({ billId: "b1", tripIds: ["t2"], revision: 1 }, mk(vi.fn().mockResolvedValue(state(["t1", "t2"]))))).toMatchObject({ kind: "confirmed", bill: { sourceTripIds: ["t1", "t2"] } });
    const d2 = mk(vi.fn().mockResolvedValue(state(["t1"])));
    expect(await runAddPheeras({ billId: "b1", tripIds: ["t2"], revision: 1 }, d2)).toMatchObject({ kind: "not_applied" });
    expect(d2.add).toHaveBeenCalledTimes(1);
    expect(await runAddPheeras({ billId: "b1", tripIds: ["t2", "t3"], revision: 1 }, mk(vi.fn().mockResolvedValue(state(["t1", "t2"]))))).toMatchObject({ kind: "unconfirmed" });
    expect(await runAddPheeras({ billId: "b1", tripIds: ["t2"], revision: 1 }, mk(vi.fn().mockRejectedValue(new Error("down"))))).toMatchObject({ kind: "unconfirmed" });
  });
  it("unsure remove: gone = confirmed, still there = not_applied", async () => {
    const lost = new ApiError("Boom", { status: 502 });
    const mk = (ids) => ({ add: vi.fn(), remove: vi.fn().mockRejectedValue(lost), readState: vi.fn().mockResolvedValue(state(ids)) });
    expect(await runRemovePheera({ billId: "b1", tripId: "t1" }, mk([]))).toMatchObject({ kind: "confirmed" });
    expect(await runRemovePheera({ billId: "b1", tripId: "t1" }, mk(["t1"]))).toMatchObject({ kind: "not_applied" });
  });
  it("reconcile helpers", () => {
    expect(reconcileAdd(["a", "b"], { sourceTripIds: ["a", "b", "c"] }).status).toBe("confirmed");
    expect(reconcileAdd(["a"], { sourceTripIds: [] }).status).toBe("not_applied");
    expect(reconcileRemove("a", { sourceTripIds: ["b"] }).status).toBe("confirmed");
  });
  it("a Pheera taken by another draft is refused by the server with its message (409)", async () => {
    const f = stubFetch();
    f.mockResolvedValueOnce(fail(409, "Some Pheeras cannot be added", [{ field: "tripIds", message: "Pheera 2 of MH12AB1234 is already in a draft bill" }]));
    await expect(addPheerasToBill("b1", ["t2"], 1)).rejects.toMatchObject({ status: 409, errors: [{ message: /already in a draft bill/ }] });
  });
});
