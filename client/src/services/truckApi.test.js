// MOCKED tests: fetch is stubbed. They check paths, methods, bodies and mapping only; they do not prove the real server or Atlas.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setUnauthorizedHandler } from "./api";
import { changeTruckStatus, createTruck, fromTruckDto, getTruck, getTruckHistory, listTrucks, toCreateTruckBody, toStatusChangeBody, toUpdateTruckBody, updateTruck } from "./truckApi";
import { call, fail, ok, stubFetch } from "./_mockHelpers";

let fetchMock;
beforeEach(() => { fetchMock = stubFetch(); });
afterEach(() => { vi.unstubAllGlobals(); setUnauthorizedHandler(null); });

const dto = (o = {}) => ({ id: "t1", truckNumber: "MH12AB1234", nickname: null, model: null, capacity: null, driverId: null, status: "WORKING", statusSince: "2026-01-01", stopReason: null, statusNote: null, ...o });

describe("truck bodies (mocked)", () => {
  it("create sends only server fields; empty capacity becomes null, driver blank becomes null", () => {
    expect(toCreateTruckBody({ truckNumber: " MH12AB1234 ", capacity: "", driverId: "", cost: 5, status: "WORKING" })).toEqual({ truckNumber: "MH12AB1234", capacity: null, driverId: null });
    expect(toCreateTruckBody({ truckNumber: "A", capacity: "12.5" })).toMatchObject({ capacity: 12.5 });
    expect(() => toCreateTruckBody({ truckNumber: "A", capacity: "abc" })).toThrow();
  });
  it("update sends only changed fields", () => {
    const cur = fromTruckDto(dto({ model: "Tata" }));
    expect(toUpdateTruckBody(cur, { truckNumber: "MH12AB1234", model: "Eicher" })).toEqual({ model: "Eicher" });
    expect(toUpdateTruckBody(cur, { model: "Tata" })).toEqual({});
  });
  it("status bodies: STOPPED reason (+note), MAINTENANCE description, never cost", () => {
    expect(toStatusChangeBody({ status: "STOPPED", reason: "OTHER", note: " Axle ", cost: 100 })).toEqual({ status: "STOPPED", reason: "OTHER", note: "Axle" });
    expect(toStatusChangeBody({ status: "MAINTENANCE", description: " Engine ", cost: 100 })).toEqual({ status: "MAINTENANCE", description: "Engine" });
    expect(toStatusChangeBody({ status: "WORKING" })).toEqual({ status: "WORKING" });
    expect(toStatusChangeBody({ status: "WORKING", note: " Repaired " })).toEqual({ status: "WORKING", note: "Repaired" });
  });
});

describe("truck API calls (mocked)", () => {
  it("list passes status/search, returns items and counts; has no pagination params", async () => {
    fetchMock.mockResolvedValueOnce(ok([dto()], { counts: { total: 3, working: 1, stopped: 1, maintenance: 1 } }));
    const r = await listTrucks({ status: "WORKING", search: "mh" });
    expect(call(fetchMock)).toMatchObject({ method: "GET", path: "/api/trucks", query: { status: "WORKING", search: "mh" } });
    expect(call(fetchMock).query.page).toBeUndefined();
    expect(r.counts.total).toBe(3);
    expect(r.items[0].id).toBe("t1");
  });
  it("detail, create, update, status and history use the real routes", async () => {
    fetchMock.mockResolvedValueOnce(ok(dto()));
    await getTruck("t1");
    fetchMock.mockResolvedValueOnce(ok(dto(), undefined, 201));
    await createTruck({ truckNumber: "MH12AB1234" });
    fetchMock.mockResolvedValueOnce(ok(dto({ model: "X" })));
    await updateTruck(fromTruckDto(dto()), { model: "X" });
    fetchMock.mockResolvedValueOnce(ok(dto({ status: "STOPPED" }), { historyEntry: { id: "h1", kind: "STATUS", from: "WORKING", to: "STOPPED", reason: "BREAKDOWN" } }));
    const s = await changeTruckStatus("t1", { status: "STOPPED", reason: "BREAKDOWN" });
    fetchMock.mockResolvedValueOnce(ok([{ id: "h1", kind: "CREATED", from: null, to: "WORKING" }]));
    const h = await getTruckHistory("t1");
    const c = fetchMock.mock.calls.map((_, i) => call(fetchMock, i));
    expect(c[0]).toMatchObject({ method: "GET", path: "/api/trucks/t1" });
    expect(c[1]).toMatchObject({ method: "POST", path: "/api/trucks", body: { truckNumber: "MH12AB1234" } });
    expect(c[2]).toMatchObject({ method: "PATCH", path: "/api/trucks/t1", body: { model: "X" } });
    expect(c[3]).toMatchObject({ method: "POST", path: "/api/trucks/t1/status", body: { status: "STOPPED", reason: "BREAKDOWN" } });
    expect(s.truck.status).toBe("STOPPED");
    expect(s.historyEntry).toMatchObject({ id: "h1", note: "" });
    expect(c[4]).toMatchObject({ method: "GET", path: "/api/trucks/t1/history" });
    expect(h[0]).toMatchObject({ from: null, to: "WORKING", reason: null });
  });
  it("update with no change throws before any request", async () => {
    await expect(updateTruck(fromTruckDto(dto()), {})).rejects.toThrow("Nothing was changed");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("truck API errors (mocked)", () => {
  it("duplicate number 409, status validation 400 and auth errors propagate unchanged", async () => {
    fetchMock.mockResolvedValueOnce(fail(409, "A truck with this number already exists"));
    await expect(createTruck({ truckNumber: "MH12AB1234" })).rejects.toMatchObject({ status: 409, message: "A truck with this number already exists" });
    fetchMock.mockResolvedValueOnce(fail(400, "Invalid", [{ field: "description", message: "Describe the maintenance" }]));
    await expect(changeTruckStatus("t1", { status: "MAINTENANCE" })).rejects.toMatchObject({ status: 400, errors: [{ field: "description", message: "Describe the maintenance" }] });
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    fetchMock.mockResolvedValueOnce(fail(401, "Please sign in"));
    await expect(listTrucks()).rejects.toMatchObject({ status: 401 });
    expect(handler).toHaveBeenCalled();
    fetchMock.mockResolvedValueOnce(fail(500, "Server error"));
    await expect(getTruck("t1")).rejects.toMatchObject({ isConnectionProblem: true });
  });
});
