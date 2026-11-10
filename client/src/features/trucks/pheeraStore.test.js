// MOCKED tests: `fetch` is stubbed (or the service is a fake). No real server or database.
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../services/api";
import { pheeraService } from "../../services/pheeraService";
import { ok, stubFetch, call } from "../../services/_mockHelpers";
import { decoratePheeras } from "./pheeraSelectors";
import { createPheeraStore } from "./pheeraStore";

afterEach(() => vi.unstubAllGlobals());

const dto = (o = {}) => ({ id: "p1", truckId: "t1", truckNumber: "MH12AB1234", businessDate: "2026-11-01", pheeraNo: 1, materialCategory: "BRICKS", materialName: "Bricks", quantity: 1000, unit: "bricks", destination: "Pune", remarks: null, customer: { id: "c1", name: "Ram" }, billingStatus: "UNBILLED", isVoided: false, ...o });
const historical = () => dto({ id: "old1", customer: null, billingStatus: null, remarks: null, submissionId: null, clientRowId: null, billId: null, bill: null });
const fakeService = (o = {}) => ({ listPheeras: vi.fn().mockResolvedValue([]), savePheeraBatch: vi.fn(), deletePheera: vi.fn(), ...o });

describe("Pheera store with the REAL pheeraService over a stubbed fetch", () => {
  it("6. loads every Pheera (voided included) and maps server fields to the names the screens use", async () => {
    const fetchMock = stubFetch();
    fetchMock.mockResolvedValueOnce(ok([dto(), dto({ id: "p2", pheeraNo: 2, isVoided: true, voidReason: "Wrong" })], { page: 1, limit: 500, total: 2 }));
    const store = createPheeraStore(pheeraService);
    await store.load();
    expect(call(fetchMock).query).toMatchObject({ includeVoided: "true", limit: "500" });
    const { records, loading, loadError } = store.getState();
    expect(loading).toBe(false);
    expect(loadError).toBeNull();
    expect(records[0]).toMatchObject({ pheeraNo: 1, pheeraNumber: 1, truckNumber: "MH12AB1234", truckRegistration: "MH12AB1234", material: "Bricks", customerName: "Ram" });
    expect(records[1]).toMatchObject({ isVoided: true, isDeleted: true, deletedReason: "Wrong" });
    // the list the screens show hides the voided one and uses the truck's current number
    const rows = decoratePheeras(records, [{ id: "t1", truckNumber: "MH12AB1234", nickname: "Red" }]);
    expect(rows.map((r) => r.id)).toEqual(["p1"]);
    expect(rows[0]).toMatchObject({ registration: "MH12AB1234", truckNickname: "Red" });
  });

  it("7. a historical Pheera with null customer, billing status, remarks and ids loads and decorates without crashing", async () => {
    const fetchMock = stubFetch();
    fetchMock.mockResolvedValueOnce(ok([historical()], { page: 1, limit: 500, total: 1 }));
    const store = createPheeraStore(pheeraService);
    await store.load();
    const [r] = store.getState().records;
    expect(r).toMatchObject({ customer: null, customerId: null, customerName: null, billingStatus: null, billId: null, remarks: "", batchId: null });
    const rows = decoratePheeras([r], []); // truck not in the list: falls back to the saved number
    expect(rows[0].registration).toBe("MH12AB1234");
  });

  it("a failed load keeps the list EMPTY and shows the server's message", async () => {
    const fetchMock = stubFetch();
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ success: false, message: "Server error" }), { status: 500, headers: { "content-type": "application/json" } }));
    const store = createPheeraStore(pheeraService);
    await store.load();
    expect(store.getState()).toMatchObject({ loading: false, records: [], loadError: "Server error" });
  });
});

describe("Pheera store with a fake service", () => {
  it("a save re-reads the list from the server and returns the service's result", async () => {
    const service = fakeService({
      listPheeras: vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: "p1" }]),
      savePheeraBatch: vi.fn().mockResolvedValue({ records: [{ id: "p1" }], duplicate: false }),
    });
    const store = createPheeraStore(service);
    await store.load();
    const result = await store.savePheeraBatch({ submissionId: "sub-12345678", truckId: "t1", businessDate: "2026-11-01", rows: [] });
    expect(service.savePheeraBatch).toHaveBeenCalledWith({ submissionId: "sub-12345678", truckId: "t1", businessDate: "2026-11-01", rows: [] });
    expect(result.records).toHaveLength(1);
    expect(store.getState().records).toEqual([{ id: "p1" }]);
  });

  it("a refused save rejects with the server's error and does not touch the list", async () => {
    const err = new ApiError("Nothing was saved", { status: 409, errors: [{ field: "trips.0.customerId", message: 'Customer "Ram" is archived' }] });
    const service = fakeService({ savePheeraBatch: vi.fn().mockRejectedValue(err) });
    const store = createPheeraStore(service);
    await store.load();
    await expect(store.savePheeraBatch({})).rejects.toBe(err);
    expect(service.listPheeras).toHaveBeenCalledTimes(1); // no re-read after a refusal
  });

  it("a confirmed save is still a success when the re-read fails (the error is shown instead)", async () => {
    const service = fakeService({
      listPheeras: vi.fn().mockResolvedValueOnce([]).mockRejectedValueOnce(new ApiError("Down", { status: 503 })),
      savePheeraBatch: vi.fn().mockResolvedValue({ records: [{ id: "p1" }], duplicate: false }),
    });
    const store = createPheeraStore(service);
    await store.load();
    await expect(store.savePheeraBatch({})).resolves.toMatchObject({ duplicate: false });
    expect(store.getState().loadError).toBe("Down");
  });

  it("delete (void) goes through the service with the reason, then re-reads", async () => {
    const service = fakeService({ deletePheera: vi.fn().mockResolvedValue({ id: "p1" }) });
    const store = createPheeraStore(service);
    await store.load();
    await store.deletePheera("p1", "Wrong entry");
    expect(service.deletePheera).toHaveBeenCalledWith("p1", "Wrong entry");
    expect(service.listPheeras).toHaveBeenCalledTimes(2);
  });

  it("a locked Pheera (409) is refused with the server's message", async () => {
    const err = new ApiError("This Pheera is reserved in a draft bill", { status: 409 });
    const store = createPheeraStore(fakeService({ deletePheera: vi.fn().mockRejectedValue(err) }));
    await expect(store.deletePheera("p1", "xyz")).rejects.toMatchObject({ status: 409, message: "This Pheera is reserved in a draft bill" });
  });
});
