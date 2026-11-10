// MOCKED tests: fetch is stubbed. They check paths, methods, bodies and mapping only; they do not prove the real server or Atlas.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setUnauthorizedHandler } from "./api";
import { archiveCustomer, createCustomer, enableInternalCustomer, fetchAllCustomers, fromCustomerDto, getCustomer, isSelectableForSale, listCustomers, restoreCustomer, toCreateCustomerBody, toUpdateCustomerBody, updateCustomer } from "./customerApi";
import { call, fail, ok, stubFetch } from "./_mockHelpers";

let fetchMock;
beforeEach(() => { fetchMock = stubFetch(); });
afterEach(() => { vi.unstubAllGlobals(); setUnauthorizedHandler(null); });

const dto = (o = {}) => ({ id: "c1", name: "Ram", kind: "NORMAL", isInternal: false, address: null, gstin: null, stateName: null, stateCode: null, contact: null, isArchived: false, archivedAt: null, archivedBy: null, archivedReason: null, revision: 3, createdAt: "2026-01-01", updatedAt: "2026-01-02", ...o });

describe("customer mapping (mocked)", () => {
  it("keeps server fields and makes nulls safe", () => {
    const c = fromCustomerDto(dto());
    expect(c).toMatchObject({ id: "c1", name: "Ram", address: "", gstin: "", revision: 3, history: [], isArchived: false });
  });
  it("selectable only when active and not Internal", () => {
    expect(isSelectableForSale(fromCustomerDto(dto()))).toBe(true);
    expect(isSelectableForSale(fromCustomerDto(dto({ isArchived: true })))).toBe(false);
    expect(isSelectableForSale(fromCustomerDto(dto({ isInternal: true, kind: "INTERNAL" })))).toBe(false);
    expect(isSelectableForSale(null)).toBe(false);
  });
  it("create body trims, drops empty optionals and upper-cases GSTIN", () => {
    expect(toCreateCustomerBody({ name: "  Ram  ", address: "", gstin: "27abcde1234f1z5", contact: " 98 " })).toEqual({ name: "Ram", gstin: "27ABCDE1234F1Z5", contact: "98" });
  });
  it("update body has only changed fields plus revision; empty when nothing changed", () => {
    const cur = fromCustomerDto(dto({ address: "A" }));
    expect(toUpdateCustomerBody(cur, { name: "Ram", address: "B" })).toEqual({ address: "B", revision: 3 });
    expect(toUpdateCustomerBody(cur, { name: "Ram" })).toEqual({});
  });
});

describe("customer API calls (mocked)", () => {
  it("list sends search/kind/page/limit and omits includeArchived by default", async () => {
    fetchMock.mockResolvedValueOnce(ok([dto()], { page: 1, limit: 100, total: 1 }));
    const r = await listCustomers({ search: "ra", kind: "NORMAL" });
    expect(call(fetchMock)).toMatchObject({ method: "GET", path: "/api/customers", query: { search: "ra", kind: "NORMAL", page: "1", limit: "100" } });
    expect(call(fetchMock).query.includeArchived).toBeUndefined();
    expect(r.items[0].name).toBe("Ram");
    expect(r.meta.total).toBe(1);
  });
  it("list sends includeArchived=true when asked", async () => {
    fetchMock.mockResolvedValueOnce(ok([], { page: 1, limit: 100, total: 0 }));
    await listCustomers({ includeArchived: true });
    expect(call(fetchMock).query.includeArchived).toBe("true");
  });
  it("fetchAllCustomers reads every page and checks the total", async () => {
    fetchMock.mockResolvedValueOnce(ok([dto({ id: "a" }), dto({ id: "b" })], { page: 1, limit: 500, total: 2 }));
    const all = await fetchAllCustomers({ includeArchived: true });
    expect(all.map((c) => c.id)).toEqual(["a", "b"]);
    expect(call(fetchMock).query).toMatchObject({ limit: "500", includeArchived: "true" });
  });
  it("detail, create, update, archive, restore and internal use the real routes", async () => {
    fetchMock.mockImplementation(async () => ok(dto()));
    await getCustomer("c1");
    await createCustomer({ name: "Ram" });
    await updateCustomer(fromCustomerDto(dto()), { name: "Ramesh" });
    await archiveCustomer("c1", "  Closed shop ");
    await restoreCustomer("c1", "Back");
    await restoreCustomer("c1");
    await enableInternalCustomer();
    const calls = fetchMock.mock.calls.map((_, i) => call(fetchMock, i));
    expect(calls[0]).toMatchObject({ method: "GET", path: "/api/customers/c1" });
    expect(calls[1]).toMatchObject({ method: "POST", path: "/api/customers", body: { name: "Ram" } });
    expect(calls[2]).toMatchObject({ method: "PATCH", path: "/api/customers/c1", body: { name: "Ramesh", revision: 3 } });
    expect(calls[3]).toMatchObject({ method: "DELETE", path: "/api/customers/c1", body: { reason: "Closed shop" } });
    expect(calls[4]).toMatchObject({ method: "POST", path: "/api/customers/c1/restore", body: { reason: "Back" } });
    expect(calls[5]).toMatchObject({ method: "POST", path: "/api/customers/c1/restore", body: {} });
    expect(calls[6]).toMatchObject({ method: "POST", path: "/api/customers/internal" });
  });
  it("update with no change throws before any request", async () => {
    await expect(updateCustomer(fromCustomerDto(dto()), { name: "Ram" })).rejects.toThrow("Nothing was changed");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("customer API errors (mocked)", () => {
  it("duplicate name 409 keeps the server message", async () => {
    fetchMock.mockResolvedValueOnce(fail(409, "A customer with this name already exists"));
    await expect(createCustomer({ name: "Ram" })).rejects.toMatchObject({ status: 409, message: "A customer with this name already exists" });
  });
  it("400 keeps field errors; archiving Internal is a 409", async () => {
    fetchMock.mockResolvedValueOnce(fail(400, "Invalid", [{ field: "reason", message: "Reason must be 3 to 200 characters" }]));
    await expect(archiveCustomer("c1", "x")).rejects.toMatchObject({ status: 400, errors: [{ field: "reason", message: "Reason must be 3 to 200 characters" }] });
    fetchMock.mockResolvedValueOnce(fail(409, "Internal / No Bill cannot be archived"));
    await expect(archiveCustomer("i1", "Not needed")).rejects.toMatchObject({ status: 409 });
  });
  it("401 calls the unauthorized handler; 403 and network errors propagate with no fallback data", async () => {
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    fetchMock.mockResolvedValueOnce(fail(401, "Please sign in"));
    await expect(listCustomers()).rejects.toMatchObject({ status: 401 });
    expect(handler).toHaveBeenCalled();
    fetchMock.mockResolvedValueOnce(fail(403, "Owner only"));
    await expect(createCustomer({ name: "Ram" })).rejects.toMatchObject({ status: 403 });
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await expect(listCustomers()).rejects.toMatchObject({ code: "NETWORK", isConnectionProblem: true });
  });
});
