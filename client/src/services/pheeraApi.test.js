// MOCKED tests: fetch is stubbed. They check paths, methods, bodies, mapping and error propagation only;
// they do not prove the real server or Atlas.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setUnauthorizedHandler } from "./api";
import { classifyApiError, ERROR_KIND, groupRowErrors } from "./apiErrorKinds";
import { assignPheeraCustomer, correctPheera, createPheera, createPheeraBatch, fetchAllPheeras, fetchBillablePheeras, getPheera, getPheeraDay, getPheeraOptions, listPheeras, releasePheera, voidPheera } from "./pheeraApi";
import { call, fail, ok, stubFetch } from "./_mockHelpers";

let fetchMock;
beforeEach(() => { fetchMock = stubFetch(); });
afterEach(() => { vi.unstubAllGlobals(); setUnauthorizedHandler(null); });

const dto = (o = {}) => ({ id: "p1", truckId: "t1", truckNumber: "MH12AB1234", businessDate: "2026-11-01", pheeraNo: 1, materialName: "Bricks", quantity: 1000, unit: "bricks", destination: "Pune", customer: { id: "c1", name: "Ram" }, billingStatus: "UNBILLED", isVoided: false, ...o });
const row = { customerId: "c1", material: "Bricks", destination: "Pune", quantity: 1000, remarks: "" };

describe("Pheera reads (mocked)", () => {
  it("list sends filters, page and limit; maps records and keeps meta.summary", async () => {
    fetchMock.mockResolvedValueOnce(ok([dto()], { page: 1, limit: 100, total: 1, summary: { count: 1 } }));
    const r = await listPheeras({ truckId: "t1", from: "2026-11-01", to: "2026-11-30", includeVoided: true });
    expect(call(fetchMock)).toMatchObject({ method: "GET", path: "/api/truck-trips", query: { truckId: "t1", from: "2026-11-01", to: "2026-11-30", includeVoided: "true", page: "1", limit: "100" } });
    expect(r.items[0]).toMatchObject({ pheeraNumber: 1, truckRegistration: "MH12AB1234" });
    expect(r.meta.summary).toEqual({ count: 1 });
  });
  it("fetchAllPheeras reads all pages; fetchBillablePheeras sends billable=true and the customer", async () => {
    fetchMock.mockImplementation(async () => ok([dto()], { page: 1, limit: 500, total: 1 }));
    expect(await fetchAllPheeras({ truckId: "t1" })).toHaveLength(1);
    expect(call(fetchMock).query).toMatchObject({ truckId: "t1", limit: "500" });
    await fetchBillablePheeras({ customerId: "c1" });
    expect(call(fetchMock, 1).query).toMatchObject({ billable: "true", customerId: "c1" });
  });
  it("day, options and detail use the real routes", async () => {
    fetchMock.mockResolvedValueOnce(ok({ date: "2026-11-01", items: [dto()], summary: { count: 1 } }));
    const d = await getPheeraDay({ date: "2026-11-01", truckId: "t1" });
    expect(call(fetchMock)).toMatchObject({ method: "GET", path: "/api/truck-trips/day", query: { date: "2026-11-01", truckId: "t1" } });
    expect(d.items[0].pheeraNumber).toBe(1);
    expect(d.summary).toEqual({ count: 1 });
    fetchMock.mockResolvedValueOnce(ok({ materials: [{ name: "Sand", key: "sand", category: "OTHER", unit: "tonnes" }], destinations: [{ name: "Pune", key: "pune" }] }));
    expect((await getPheeraOptions()).materials[0].name).toBe("Sand");
    expect(call(fetchMock, 1).path).toBe("/api/truck-trips/options");
    fetchMock.mockResolvedValueOnce(ok(dto({ billingHistory: [{ x: 1 }], audit: [] })));
    expect((await getPheera("p1")).billingHistory).toEqual([{ x: 1 }]);
    expect(call(fetchMock, 2).path).toBe("/api/truck-trips/p1");
  });
  it("a historical record keeps null customer and billing status", async () => {
    fetchMock.mockResolvedValueOnce(ok(dto({ customer: null, billingStatus: null })));
    expect(await getPheera("p1")).toMatchObject({ customer: null, customerId: null, billingStatus: null });
  });
});

describe("Pheera writes (mocked)", () => {
  it("batch posts truckId, businessDate, submissionId and rows with clientRowId; returns duplicate and summary", async () => {
    fetchMock.mockResolvedValueOnce(ok([dto(), dto({ id: "p2", pheeraNo: 2 })], { duplicate: false, summary: { count: 2 } }, 201));
    const r = await createPheeraBatch({ truckId: "t1", businessDate: "2026-11-01", submissionId: "sub-12345678", rows: [row, { ...row, material: "Sand", quantity: "7.5" }] });
    const c = call(fetchMock);
    expect(c).toMatchObject({ method: "POST", path: "/api/truck-trips/batch" });
    expect(c.body).toMatchObject({ truckId: "t1", businessDate: "2026-11-01", submissionId: "sub-12345678" });
    expect(c.body.trips.map((t) => t.clientRowId)).toEqual(["row-1", "row-2"]);
    expect(c.body.trips[1]).toMatchObject({ material: "OTHER", customMaterialName: "Sand", quantity: 7.5 });
    expect(JSON.stringify(c.body)).not.toMatch(/pheeraNo|pheeraNumber|unit|truckRegistration|batchId/);
    expect(r).toMatchObject({ duplicate: false, submissionId: "sub-12345678", summary: { count: 2 } });
    expect(r.records).toHaveLength(2);
  });
  it("batch makes a submissionId when none is given and flags a duplicate answer", async () => {
    fetchMock.mockResolvedValueOnce(ok([dto()], { duplicate: true }));
    const r = await createPheeraBatch({ truckId: "t1", businessDate: "2026-11-01", rows: [row] });
    expect(call(fetchMock).body.submissionId).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
    expect(r.duplicate).toBe(true);
  });
  it("single create posts one flat body", async () => {
    fetchMock.mockResolvedValueOnce(ok(dto(), { duplicate: false }, 201));
    const r = await createPheera({ truckId: "t1", businessDate: "2026-11-01", row, clientRowId: "r1", submissionId: "sub-12345678" });
    expect(call(fetchMock)).toMatchObject({ method: "POST", path: "/api/truck-trips", body: { truckId: "t1", businessDate: "2026-11-01", material: "BRICKS", quantity: 1000, clientRowId: "r1", submissionId: "sub-12345678" } });
    expect(r.record.pheeraNo).toBe(1);
  });
  it("correct, void, assign customer and release use the real routes and bodies", async () => {
    fetchMock.mockImplementation(async () => ok(dto()));
    await correctPheera("p1", { quantity: 900 }, "Typo");
    await voidPheera("p1", " Wrong entry ");
    await assignPheeraCustomer("p1", "c2", "Was historical");
    await releasePheera("p1", "Bill cancelled");
    const c = fetchMock.mock.calls.map((_, i) => call(fetchMock, i));
    expect(c[0]).toMatchObject({ method: "PATCH", path: "/api/truck-trips/p1", body: { quantity: 900, reason: "Typo" } });
    expect(c[1]).toMatchObject({ method: "POST", path: "/api/truck-trips/p1/void", body: { reason: "Wrong entry" } });
    expect(c[2]).toMatchObject({ method: "PATCH", path: "/api/truck-trips/p1/customer", body: { customerId: "c2", reason: "Was historical" } });
    expect(c[3]).toMatchObject({ method: "POST", path: "/api/truck-trips/p1/release", body: { reason: "Bill cancelled" } });
  });
  it("invalid input throws before any request", async () => {
    await expect(createPheeraBatch({ truckId: "t1", businessDate: "d", rows: [{ ...row, quantity: "x" }] })).rejects.toThrow(/number/);
    await expect(correctPheera("p1", {}, "r")).rejects.toThrow("Nothing was changed");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("Pheera errors (mocked): propagated, never replaced by sample data", () => {
  it("unknown customer 400 keeps row field errors; nothing saved", async () => {
    fetchMock.mockResolvedValueOnce(fail(400, "Nothing was saved", [{ field: "trips.1.customerId", message: "Customer not found" }]));
    const e = await createPheeraBatch({ truckId: "t1", businessDate: "2026-11-01", rows: [row, row] }).catch((x) => x);
    expect(e).toMatchObject({ status: 400, message: "Nothing was saved" });
    expect(classifyApiError(e)).toMatchObject({ kind: ERROR_KIND.VALIDATION, nothingSaved: true });
    expect(groupRowErrors(e).rows).toEqual({ 1: { customerId: "Customer not found" } });
  });
  it("archived customer 409 is classified and keeps the row", async () => {
    fetchMock.mockResolvedValueOnce(fail(409, "Nothing was saved", [{ field: "trips.0.customerId", message: 'Customer "Ram" is archived' }]));
    const e = await createPheeraBatch({ truckId: "t1", businessDate: "2026-11-01", rows: [row] }).catch((x) => x);
    expect(classifyApiError(e).kind).toBe(ERROR_KIND.ARCHIVED_CUSTOMER);
    expect(groupRowErrors(e).rows[0].customerId).toMatch(/archived/);
  });
  it("locked Pheera 409 on correct, void, assign and release keeps the server message", async () => {
    for (const run of [() => correctPheera("p1", { quantity: 1 }, "x1x"), () => voidPheera("p1", "xyz"), () => assignPheeraCustomer("p1", "c2", "xyz"), () => releasePheera("p1", "xyz")]) {
      fetchMock.mockResolvedValueOnce(fail(409, "This Pheera is reserved in a draft bill"));
      await expect(run()).rejects.toMatchObject({ status: 409, message: "This Pheera is reserved in a draft bill" });
    }
  });
  it("401 calls the unauthorized handler; 403, 5xx and network errors propagate", async () => {
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    fetchMock.mockResolvedValueOnce(fail(401, "Please sign in"));
    await expect(listPheeras()).rejects.toMatchObject({ status: 401 });
    expect(handler).toHaveBeenCalled();
    fetchMock.mockResolvedValueOnce(fail(403, "Owner only"));
    await expect(voidPheera("p1", "xyz")).rejects.toMatchObject({ status: 403 });
    fetchMock.mockResolvedValueOnce(fail(500, "Server error"));
    await expect(getPheeraDay({ date: "2026-11-01" })).rejects.toMatchObject({ isConnectionProblem: true });
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const e = await createPheeraBatch({ truckId: "t1", businessDate: "2026-11-01", submissionId: "sub-12345678", rows: [row] }).catch((x) => x);
    expect(classifyApiError(e)).toMatchObject({ kind: ERROR_KIND.CONNECTION, nothingSaved: false });
  });
  it("a retry after a lost connection reuses the same submissionId", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await createPheeraBatch({ truckId: "t1", businessDate: "2026-11-01", submissionId: "sub-12345678", rows: [row] }).catch(() => {});
    fetchMock.mockResolvedValueOnce(ok([dto()], { duplicate: true }));
    const r = await createPheeraBatch({ truckId: "t1", businessDate: "2026-11-01", submissionId: "sub-12345678", rows: [row] });
    expect(call(fetchMock, 0).body.submissionId).toBe(call(fetchMock, 1).body.submissionId);
    expect(r.duplicate).toBe(true);
  });
});
