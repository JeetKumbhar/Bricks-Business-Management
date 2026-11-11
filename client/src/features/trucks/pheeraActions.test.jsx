// MOCKED tests (stubbed fetch / fake service / static markup). No real server or database.
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../services/api";
import { pheeraService } from "../../services/pheeraService";
import { call, fail, ok, stubFetch } from "../../services/_mockHelpers";
import { runPheeraAction } from "./pheeraActionFlow";
import { availableActions, correctionChanges, correctionDefaults, isLockedRecord, lifecycleKey, lockedReason } from "./pheeraLifecycle";
import { createPheeraStore } from "./pheeraStore";
import { decoratePheeras } from "./pheeraSelectors";
import PheeraTable from "./PheeraTable";
import { AssignCustomerModal, CorrectPheeraModal, ReleasePheeraModal } from "./PheeraActionModals";

vi.mock("../../components/ui/Modal", () => ({
  default: ({ open, title, description, children, footer }) => (open ? <section><h2>{title}</h2><p>{description}</p>{children}<footer>{footer}</footer></section> : null),
}));
afterEach(() => vi.unstubAllGlobals());

const rec = (o = {}) => ({ id: "p1", truckId: "t1", registration: "MH12AB1234", truckRegistration: "MH12AB1234", businessDate: "2026-11-01", pheeraNumber: 1, material: "Bricks", quantity: 1000, unit: "bricks", destination: "Pune", remarks: "", customerId: "c1", customerName: "Ram", billingStatus: "UNBILLED", isVoided: false, isDeleted: false, corrected: false, ...o });
const dto = (o = {}) => ({ id: "p1", truckId: "t1", truckNumber: "MH12AB1234", businessDate: "2026-11-01", pheeraNo: 1, materialCategory: "BRICKS", materialName: "Bricks", quantity: 1000, unit: "bricks", destination: "Pune", remarks: null, customer: { id: "c1", name: "Ram" }, billingStatus: "UNBILLED", isVoided: false, ...o });
const page = (items) => ok(items, { page: 1, limit: 500, total: items.length });

describe("lifecycle display and offered actions", () => {
  it("each billing status maps to its own label; a missing status is never turned into 'not billed'", () => {
    expect(["UNBILLED", "RESERVED", "BILLED", "NOT_BILLABLE", null, undefined].map((s) => lifecycleKey(rec({ billingStatus: s })))).toEqual(["UNBILLED", "RESERVED", "BILLED", "NOT_BILLABLE", "HISTORICAL", "HISTORICAL"]);
    expect(lifecycleKey(rec({ isVoided: true, billingStatus: "UNBILLED" }))).toBe("VOIDED");
    expect(lifecycleKey(rec({ billingStatus: "WEIRD" }))).toBe("HISTORICAL");
  });
  it("offers actions by lifecycle (the server stays the authority)", () => {
    expect(availableActions(rec())).toEqual({ correct: true, assign: true, release: false, void: true });
    expect(availableActions(rec({ billingStatus: null, customerId: null, customerName: null }))).toMatchObject({ correct: true, assign: true, release: false });
    expect(availableActions(rec({ billingStatus: "RESERVED" }))).toEqual({ correct: false, assign: false, release: false, void: false });
    expect(availableActions(rec({ billingStatus: "BILLED" }))).toEqual({ correct: false, assign: false, release: true, void: false });
    expect(availableActions(rec({ isVoided: true }))).toEqual({ correct: false, assign: false, release: false, void: false });
    expect(isLockedRecord(rec({ billingStatus: "RESERVED" }))).toBe(true);
    expect(lockedReason(rec({ billingStatus: "RESERVED" }))).toMatch(/draft bill/);
  });
  it("renders every lifecycle (incl. historical null and voided with its reason) without crashing", () => {
    const html = renderToStaticMarkup(<PheeraTable rows={[rec({ id: "a" }), rec({ id: "b", billingStatus: null, customerName: null, customerId: null }), rec({ id: "c", isVoided: true, isDeleted: true, deletedReason: "Entered twice" }), rec({ id: "d", corrected: true })]} onCorrect={() => {}} onAssign={() => {}} onRelease={() => {}} onDelete={() => {}} />);
    for (const t of ["Not billed", "Older record", "Voided", "Entered twice", "No customer", "corrected"]) expect(html).toContain(t);
  });
  it("a voided or locked Pheera offers no correct / change customer button; Release shows only for billed", () => {
    const row = (o) => renderToStaticMarkup(<PheeraTable rows={[rec(o)]} onCorrect={() => {}} onAssign={() => {}} onRelease={() => {}} />);
    expect(row({ billingStatus: "RESERVED" })).not.toContain("Correct Pheera");
    expect(row({ isVoided: true, isDeleted: true })).not.toContain("Correct Pheera");
    expect(row({ billingStatus: "BILLED" })).toContain("Release Pheera");
    expect(row({ billingStatus: "UNBILLED" })).not.toContain("Release Pheera");
    expect(row({ customerName: null, customerId: null, billingStatus: null })).toContain("Assign customer to");
    expect(row({})).toContain("Change customer of");
  });
});

describe("correction changes", () => {
  const form = (o = {}) => ({ material: "Bricks", destination: "Pune", quantity: "1000", remarks: "", ...o });
  it("sends only what changed", () => {
    expect(correctionChanges(rec(), form())).toEqual({});
    expect(correctionChanges(rec(), form({ destination: "Thane" }))).toEqual({ destination: "Thane" });
    expect(correctionChanges(rec(), form({ quantity: "1200" }))).toEqual({ quantity: "1200" });
    expect(correctionChanges(rec(), form({ remarks: "late" }))).toEqual({ remarks: "late" });
  });
  it("re-sends the quantity whenever the material changes", () => {
    expect(correctionChanges(rec(), form({ material: "Sand", quantity: "1000" }))).toEqual({ material: "Sand", quantity: "1000" });
  });
  it("starts from the saved values", () => {
    expect(correctionDefaults(rec({ material: "Stone Dust", unit: "tonnes", quantity: 4.5 }))).toMatchObject({ material: "Other", customName: "Stone Dust", quantity: "4.5" });
  });
});

describe("service calls (real pheeraService over a stubbed fetch)", () => {
  it("correct sends only changed fields + reason to PATCH /truck-trips/:id and keeps server-owned fields out", async () => {
    const f = stubFetch();
    f.mockResolvedValueOnce(ok(dto({ destination: "Thane", corrected: true })));
    const r = await pheeraService.correctPheera("p1", { destination: "Thane" }, " Wrong place ");
    expect(call(f)).toMatchObject({ method: "PATCH", path: "/api/truck-trips/p1", body: { destination: "Thane", reason: "Wrong place" } });
    expect(Object.keys(call(f).body).sort()).toEqual(["destination", "reason"]);
    expect(r).toMatchObject({ destination: "Thane", corrected: true });
  });
  it("assign customer and release hit their own endpoints", async () => {
    const f = stubFetch();
    f.mockResolvedValueOnce(ok(dto({ customer: { id: "c2", name: "Sita" } }))).mockResolvedValueOnce(ok(dto()));
    await pheeraService.assignCustomer("p1", "c2", "Historic");
    await pheeraService.releasePheera("p1", "Invoice cancelled");
    expect(call(f, 0)).toMatchObject({ method: "PATCH", path: "/api/truck-trips/p1/customer", body: { customerId: "c2", reason: "Historic" } });
    expect(call(f, 1)).toMatchObject({ method: "POST", path: "/api/truck-trips/p1/release", body: { reason: "Invoice cancelled" } });
  });
});

describe("store: every change re-reads the list, one change at a time per Pheera", () => {
  const fake = (o = {}) => ({ listPheeras: vi.fn().mockResolvedValue([]), savePheeraBatch: vi.fn(), deletePheera: vi.fn(), correctPheera: vi.fn(), assignCustomer: vi.fn(), releasePheera: vi.fn(), ...o });
  it("refreshes after correct / assign / release / void", async () => {
    const s = fake({ correctPheera: vi.fn().mockResolvedValue({}), assignCustomer: vi.fn().mockResolvedValue({}), releasePheera: vi.fn().mockResolvedValue({}), deletePheera: vi.fn().mockResolvedValue({}) });
    const store = createPheeraStore(s);
    await store.correctPheera("p1", { remarks: "x" }, "why");
    await store.assignCustomer("p1", "c2", "why");
    await store.releasePheera("p1", "why");
    await store.deletePheera("p1", "why");
    expect(s.listPheeras).toHaveBeenCalledTimes(4);
  });
  it("a second change to the same Pheera while the first runs is refused (no duplicate request)", async () => {
    let release;
    const s = fake({ correctPheera: vi.fn(() => new Promise((res) => { release = res; })) });
    const store = createPheeraStore(s);
    const first = store.correctPheera("p1", { remarks: "x" }, "why");
    await expect(store.correctPheera("p1", { remarks: "y" }, "why")).rejects.toThrow(/in progress/);
    release({});
    await first;
    expect(s.correctPheera).toHaveBeenCalledTimes(1);
    const again = store.correctPheera("p1", { remarks: "z" }, "why"); // free again afterwards
    release({});
    await again;
    expect(s.correctPheera).toHaveBeenCalledTimes(2);
  });
  it("a refusal (409) does not refresh and leaves the list alone; a lost connection re-reads the list", async () => {
    const refused = fake({ correctPheera: vi.fn().mockRejectedValue(new ApiError("Locked", { status: 409 })) });
    const a = createPheeraStore(refused);
    await expect(a.correctPheera("p1", { remarks: "x" }, "why")).rejects.toThrow("Locked");
    expect(refused.listPheeras).not.toHaveBeenCalled();
    const lost = fake({ assignCustomer: vi.fn().mockRejectedValue(new ApiError("Network", { code: "NETWORK" })) });
    const b = createPheeraStore(lost);
    await expect(b.assignCustomer("p1", "c2", "why")).rejects.toThrow();
    expect(lost.listPheeras).toHaveBeenCalledTimes(1);
  });
  it("after a successful correction the new values come from the server's re-read", async () => {
    const f = stubFetch();
    f.mockResolvedValueOnce(ok(dto({ destination: "Thane", corrected: true }))).mockResolvedValueOnce(page([dto({ destination: "Thane", corrected: true })]));
    const store = createPheeraStore(pheeraService);
    await store.correctPheera("p1", { destination: "Thane" }, "Wrong place");
    expect(store.getState().records[0]).toMatchObject({ destination: "Thane", corrected: true });
  });
  it("a voided record leaves the active list but stays in the voided one", async () => {
    const f = stubFetch();
    f.mockResolvedValueOnce(ok(dto({ isVoided: true, voidReason: "Dup" }))).mockResolvedValueOnce(page([dto({ isVoided: true, voidReason: "Dup" })]));
    const store = createPheeraStore(pheeraService);
    await store.deletePheera("p1", "Dup");
    const { records } = store.getState();
    expect(decoratePheeras(records, [])).toHaveLength(0);
    expect(decoratePheeras(records, [], { voided: true })[0]).toMatchObject({ isVoided: true, deletedReason: "Dup" });
  });
});

describe("outcome of an action", () => {
  it("success", async () => expect(await runPheeraAction(async () => 5)).toEqual({ ok: true, result: 5 }));
  it("a server refusal keeps its message and field errors, and is NOT unsure", async () => {
    const out = await runPheeraAction(async () => { throw new ApiError("Customer is archived", { status: 409, errors: [{ field: "customerId", message: "Customer is archived" }] }); });
    expect(out).toMatchObject({ ok: false, unsure: false, message: "Customer is archived", fieldErrors: { customerId: "Customer is archived" } });
  });
  it("a locked-Pheera refusal arrives as shown by the server", async () => {
    const f = stubFetch();
    f.mockResolvedValueOnce(fail(409, "This Pheera is in a draft bill and cannot be corrected"));
    const out = await runPheeraAction(() => pheeraService.correctPheera("p1", { remarks: "x" }, "why"));
    expect(out).toMatchObject({ ok: false, unsure: false, message: "This Pheera is in a draft bill and cannot be corrected" });
  });
  it("a lost connection / 5xx is unsure", async () => {
    expect((await runPheeraAction(async () => { throw new ApiError("Network", { code: "NETWORK" }); })).unsure).toBe(true);
    expect((await runPheeraAction(async () => { throw new ApiError("Boom", { status: 500 }); })).unsure).toBe(true);
  });
  it("a plain local error is a message, not unsure", async () => {
    expect(await runPheeraAction(async () => { throw new Error("Nothing was changed"); })).toMatchObject({ ok: false, unsure: false, message: "Nothing was changed" });
  });
});

describe("dialogs (static markup)", () => {
  const choices = { customers: [{ id: "c1", name: "Ram" }, { id: "c2", name: "Sita" }], internal: { id: "i1", name: "Internal / No Bill" } };
  it("correct dialog starts from the saved values, asks for a reason and shows nothing when closed", () => {
    expect(renderToStaticMarkup(<CorrectPheeraModal record={null} onClose={() => {}} onSubmit={() => {}} />)).toBe("");
    const html = renderToStaticMarkup(<CorrectPheeraModal record={rec({ destination: "Pune" })} onClose={() => {}} onSubmit={() => {}} />);
    expect(html).toContain("Correct Pheera");
    expect(html).toContain('value="Pune"');
    expect(html).toContain("Reason for the correction");
    expect(html).toContain("cannot be changed");
  });
  it("assign dialog excludes the current customer, offers Internal separately, and labels historical records", () => {
    const html = renderToStaticMarkup(<AssignCustomerModal record={rec()} choices={choices} onClose={() => {}} onSubmit={() => {}} />);
    expect(html).toContain("Change customer");
    expect(html).toContain("Sita");
    expect(html).toContain("Internal / No Bill (not invoiced)");
    expect(html).not.toMatch(/<option value="c1">/);
    const old = renderToStaticMarkup(<AssignCustomerModal record={rec({ customerId: null, customerName: null, billingStatus: null })} choices={choices} onClose={() => {}} onSubmit={() => {}} />);
    expect(old).toContain("Assign customer");
    expect(old).toContain("No customer (older record)");
  });
  it("release dialog names the invoice and asks for a reason", () => {
    const html = renderToStaticMarkup(<ReleasePheeraModal record={rec({ billingStatus: "BILLED", bill: { id: "b1", billNumber: "0007", status: "CANCELLED" } })} onClose={() => {}} onSubmit={() => {}} />);
    expect(html).toContain("invoice 0007");
    expect(html).toContain("Reason for releasing");
  });
  it("a Pheera saving shows the loading state on its button and disables the form", () => {
    const html = renderToStaticMarkup(<ReleasePheeraModal record={rec({ billingStatus: "BILLED" })} submitting onClose={() => {}} onSubmit={() => {}} />);
    expect(html).toContain("<fieldset disabled");
  });
});
