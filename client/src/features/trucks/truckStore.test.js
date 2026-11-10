// MOCKED tests: the truck API is replaced by fakes (and, in the last group, `fetch` is stubbed). No real server or database.
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, setUnauthorizedHandler } from "../../services/api";
import * as realTruckApi from "../../services/truckApi";
import { createSingleFlight } from "./createStore";
import { createTruckStore } from "./truckStore";
import { fail, ok, stubFetch } from "../../services/_mockHelpers";

afterEach(() => {
  vi.unstubAllGlobals();
  setUnauthorizedHandler(null);
});

const truck = (o = {}) => ({ id: "t1", truckNumber: "MH12AB1234", nickname: "", model: "Tata", capacity: 4, driverId: null, status: "WORKING", statusSince: "2026-11-01", stopReason: null, statusNote: "", ...o });
const apiError = (status, message, errors = []) => new ApiError(message, { status, errors });
const fakeApi = (o = {}) => ({
  listTrucks: vi.fn().mockResolvedValue({ items: [truck(), truck({ id: "t2", truckNumber: "MH12CD5678" })], counts: { total: 2 } }),
  createTruck: vi.fn(async (v) => truck({ id: "t3", ...v })),
  updateTruck: vi.fn(async (cur, ch) => ({ ...cur, ...ch })),
  changeTruckStatus: vi.fn(async (id, input) => ({ truck: truck({ id, status: input.status, stopReason: input.reason ?? null }), historyEntry: { id: "h1" } })),
  getTruckHistory: vi.fn().mockResolvedValue([{ id: "h1", kind: "CREATED" }]),
  ...o,
});

describe("truck store (mocked API)", () => {
  it("1. trucks load from the server and the state becomes ready", async () => {
    const api = fakeApi();
    const store = createTruckStore(api);
    expect(store.getState()).toMatchObject({ status: "loading", trucks: [] });
    await store.load();
    expect(store.getState()).toMatchObject({ status: "ready", loadError: "" });
    expect(store.getState().trucks.map((t) => t.id)).toEqual(["t1", "t2"]);
  });

  it("2. a failed load shows the server's message and an EMPTY list (no sample data)", async () => {
    const store = createTruckStore(fakeApi({ listTrucks: vi.fn().mockRejectedValue(apiError(500, "Server error")) }));
    await store.load();
    expect(store.getState()).toMatchObject({ status: "error", loadError: "Server error", trucks: [] });
  });

  it("2b. a retry after a failure recovers", async () => {
    const listTrucks = vi.fn().mockRejectedValueOnce(new TypeError("x")).mockResolvedValue({ items: [truck()], counts: null });
    const store = createTruckStore(fakeApi({ listTrucks }));
    await store.load();
    expect(store.getState().status).toBe("error");
    await store.load();
    expect(store.getState()).toMatchObject({ status: "ready", trucks: [expect.objectContaining({ id: "t1" })] });
  });

  it("3. creating a truck adds the server's truck (server id) to the list", async () => {
    const api = fakeApi();
    const store = createTruckStore(api);
    await store.load();
    const saved = await store.addTruck({ truckNumber: " mh12ef9999 ", nickname: "", model: "Eicher", capacity: "6", driverId: "" });
    expect(api.createTruck).toHaveBeenCalledWith(expect.objectContaining({ truckNumber: "MH12EF9999" }));
    expect(saved.id).toBe("t3");
    expect(store.getState().trucks.map((t) => t.id)).toEqual(["t1", "t2", "t3"]);
  });

  it("3b. a refused create changes nothing and the server's message and field errors are kept", async () => {
    const err = apiError(409, "A truck with this number already exists", [{ field: "truckNumber", message: "Already used" }]);
    const store = createTruckStore(fakeApi({ createTruck: vi.fn().mockRejectedValue(err) }));
    await store.load();
    await expect(store.addTruck({ truckNumber: "MH12AB1234" })).rejects.toBe(err);
    expect(store.getState().trucks).toHaveLength(2);
  });

  it("3c. editing sends the CURRENT truck and the changes, and replaces it with the server's answer", async () => {
    const api = fakeApi();
    const store = createTruckStore(api);
    await store.load();
    await store.updateTruck("t1", { model: "Eicher" });
    expect(api.updateTruck).toHaveBeenCalledWith(expect.objectContaining({ id: "t1" }), { model: "Eicher" });
    expect(store.getState().trucks.find((t) => t.id === "t1").model).toBe("Eicher");
  });

  it("3d. editing a truck that is not in the list rejects without any request", async () => {
    const api = fakeApi();
    const store = createTruckStore(api);
    await store.load();
    await expect(store.updateTruck("nope", { model: "X" })).rejects.toThrow(/no longer exists/);
    expect(api.updateTruck).not.toHaveBeenCalled();
  });

  it("4. a status change replaces the truck from the server's answer and passes reason/note/description (no cost)", async () => {
    const api = fakeApi();
    const store = createTruckStore(api);
    await store.load();
    const res = await store.changeStatus("t1", { status: "STOPPED", reason: "BREAKDOWN", note: "Gearbox" });
    expect(api.changeTruckStatus).toHaveBeenCalledWith("t1", { status: "STOPPED", reason: "BREAKDOWN", note: "Gearbox" });
    expect(res.historyEntry.id).toBe("h1");
    expect(store.getState().trucks.find((t) => t.id === "t1")).toMatchObject({ status: "STOPPED", stopReason: "BREAKDOWN" });
  });

  it("4b. a refused status change (400) leaves the truck as it was", async () => {
    const err = apiError(400, "Invalid", [{ field: "reason", message: "Choose why the truck stopped" }]);
    const store = createTruckStore(fakeApi({ changeTruckStatus: vi.fn().mockRejectedValue(err) }));
    await store.load();
    await expect(store.changeStatus("t1", { status: "STOPPED" })).rejects.toBe(err);
    expect(store.getState().trucks.find((t) => t.id === "t1").status).toBe("WORKING");
  });

  it("history loads per truck, and is read again after the truck changes", async () => {
    const api = fakeApi();
    const store = createTruckStore(api);
    await store.load();
    await store.loadHistory("t1");
    expect(store.getState().histories.t1).toMatchObject({ status: "ready", items: [{ id: "h1" }] });
    await store.changeStatus("t1", { status: "MAINTENANCE", description: "Engine" });
    expect(store.getState().histories.t1).toBeUndefined();
    api.getTruckHistory.mockRejectedValueOnce(apiError(500, "Down"));
    await store.loadHistory("t1");
    expect(store.getState().histories.t1).toMatchObject({ status: "error", error: "Down", items: [] });
  });

  it("5. there is no way to save maintenance, service records, cost, delete or pagination", () => {
    const store = createTruckStore(fakeApi());
    for (const name of ["addServiceRecord", "addMaintenance", "deleteTruck", "removeTruck", "getMaintenance"]) expect(store[name]).toBeUndefined();
    expect(Object.keys(realTruckApi).some((k) => /maintenance|service|delete|remove/i.test(k))).toBe(false);
  });

  it("5b. the REAL status request never carries a cost, even when the form passed one", async () => {
    const fetchMock = stubFetch();
    fetchMock.mockResolvedValueOnce(ok(truck({ status: "MAINTENANCE" }), { historyEntry: { id: "h2" } }));
    const store = createTruckStore(realTruckApi);
    store.setState({ trucks: [truck()], status: "ready" });
    await store.changeStatus("t1", { status: "MAINTENANCE", description: "Engine service", cost: 5000 });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toEqual({ status: "MAINTENANCE", description: "Engine service" });
  });

  it("the duplicate-number check ignores case, spaces and hyphens, and ignores the truck being edited", async () => {
    const store = createTruckStore(fakeApi());
    await store.load();
    expect(store.isTruckNumberTaken("mh-12 ab 1234")).toBe(true);
    expect(store.isTruckNumberTaken("MH12AB1234", "t1")).toBe(false);
    expect(store.isTruckNumberTaken("NEW 1")).toBe(false);
  });

  it("a REAL 401 on load is an error state (api.js tells the app to sign in) and no data is shown", async () => {
    const fetchMock = stubFetch();
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    fetchMock.mockResolvedValueOnce(fail(401, "Please sign in"));
    const store = createTruckStore(realTruckApi);
    await store.load();
    expect(handler).toHaveBeenCalled();
    expect(store.getState()).toMatchObject({ status: "error", trucks: [] });
  });
});

describe("single flight (duplicate submissions)", () => {
  it("13. a second call while one is running is ignored", async () => {
    const flight = createSingleFlight();
    let release;
    const slow = vi.fn(() => new Promise((r) => { release = r; }));
    const first = flight.run(slow);
    expect(flight.busy).toBe(true);
    expect(await flight.run(slow)).toBeUndefined();
    expect(slow).toHaveBeenCalledTimes(1);
    release("done");
    expect(await first).toBe("done");
    expect(flight.busy).toBe(false);
    await flight.run(async () => "again");
  });
  it("it is released after a failure too", async () => {
    const flight = createSingleFlight();
    await expect(flight.run(async () => { throw new Error("x"); })).rejects.toThrow("x");
    expect(flight.busy).toBe(false);
  });
});
