// MOCKED tests: the customer API is a fake, or `fetch` is stubbed. No real server or database.
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../services/api";
import * as realApi from "../../services/customerApi";
import { fromCustomerDto } from "../../services/customerApi";
import { call, fail, ok, stubFetch } from "../../services/_mockHelpers";
import { createCustomerStore } from "./customerStore";
import { splitCustomers } from "./customerChoices";

afterEach(() => vi.unstubAllGlobals());

const dto = (o = {}) => ({ id: "c1", name: "Ram", kind: "NORMAL", isInternal: false, isArchived: false, revision: 1, address: null, gstin: null, stateName: null, stateCode: null, contact: null, ...o });
const cust = (o) => fromCustomerDto(dto(o));
const conflict = (message, errors = []) => new ApiError(message, { status: 409, errors });
const fakeApi = (o = {}) => ({
  fetchAllCustomers: vi.fn().mockResolvedValue([cust(), cust({ id: "c2", name: "Zed" }), cust({ id: "c3", name: "Old", isArchived: true })]),
  createCustomer: vi.fn(async (v) => cust({ id: "c9", name: v.name })),
  updateCustomer: vi.fn(async (cur, ch) => ({ ...cur, ...ch, revision: cur.revision + 1 })),
  archiveCustomer: vi.fn(async (id) => cust({ id, name: "Ram", isArchived: true, revision: 2 })),
  restoreCustomer: vi.fn(async (id) => cust({ id, name: "Old", isArchived: false, revision: 3 })),
  enableInternalCustomer: vi.fn(async () => cust({ id: "i1", name: "Internal / No Bill", kind: "INTERNAL", isInternal: true })),
  ...o,
});

describe("customer store (mocked API)", () => {
  it("1. loads every customer (archived included) from the server", async () => {
    const api = fakeApi();
    const store = createCustomerStore(api);
    expect(store.getState().status).toBe("loading");
    expect(await store.load()).toMatchObject({ ok: true });
    expect(api.fetchAllCustomers).toHaveBeenCalledWith({ includeArchived: true }, expect.any(Object));
    expect(store.getState()).toMatchObject({ status: "ready", loadError: "" });
    expect(store.getState().items).toHaveLength(3);
  });

  it("3. a failed load shows the server's message and an EMPTY list (no sample customers); a retry recovers", async () => {
    const fetchAllCustomers = vi.fn().mockRejectedValueOnce(new ApiError("Server error", { status: 500 })).mockResolvedValueOnce([cust()]);
    const store = createCustomerStore(fakeApi({ fetchAllCustomers }));
    expect(await store.load()).toMatchObject({ ok: false });
    expect(store.getState()).toMatchObject({ status: "error", loadError: "Server error", items: [] });
    await store.load();
    expect(store.getState()).toMatchObject({ status: "ready", items: [expect.objectContaining({ id: "c1" })] });
  });

  it("a re-read of a shown list does not blank it", async () => {
    const store = createCustomerStore(fakeApi());
    await store.load();
    const seen = [];
    store.subscribe(() => seen.push(store.getState().status));
    await store.load();
    expect(seen).not.toContain("loading");
  });

  it("4. create adds the server's customer (server id) to the list", async () => {
    const api = fakeApi();
    const store = createCustomerStore(api);
    await store.load();
    const c = await store.create({ name: "New Co" });
    expect(api.createCustomer).toHaveBeenCalledWith({ name: "New Co" });
    expect(c.id).toBe("c9");
    expect(store.getState().items.map((x) => x.id)).toContain("c9");
  });

  it("9. a duplicate name (409 with the name field) is refused, the server's words are kept and the list is unchanged", async () => {
    const err = conflict('A customer named "Ram" already exists', [{ field: "name", message: "Name already exists" }]);
    const store = createCustomerStore(fakeApi({ createCustomer: vi.fn().mockRejectedValue(err) }));
    await store.load();
    await expect(store.create({ name: "ram " })).rejects.toBe(err);
    expect(store.getState().items).toHaveLength(3);
  });

  it("9b. an archived name cannot be reused: the server's message (with the restore hint) is passed on", async () => {
    const err = conflict('"Old" is an archived customer. Restore it instead', [{ field: "name", message: "Archived name" }]);
    const store = createCustomerStore(fakeApi({ createCustomer: vi.fn().mockRejectedValue(err) }));
    await expect(store.create({ name: "Old" })).rejects.toMatchObject({ status: 409, message: expect.stringContaining("archived") });
  });

  it("5. edit sends the customer AS OPENED (its revision) and the list shows the server's answer", async () => {
    const api = fakeApi();
    const store = createCustomerStore(api);
    await store.load();
    const opened = store.getState().items.find((c) => c.id === "c1");
    await store.update(opened, { name: "Ramesh" });
    expect(api.updateCustomer).toHaveBeenCalledWith(opened, { name: "Ramesh" });
    expect(store.getState().items.find((c) => c.id === "c1")).toMatchObject({ name: "Ramesh", revision: 2 });
  });

  it("5b. an edit made on stale data is refused with 409 (nothing is overwritten) and the list keeps the newer saved data", async () => {
    const err = conflict("This customer was changed by someone else. Reload and try again");
    const store = createCustomerStore(fakeApi({ updateCustomer: vi.fn().mockRejectedValue(err) }));
    await store.load();
    await expect(store.update(cust({ revision: 1 }), { name: "Mine" })).rejects.toBe(err);
    expect(store.getState().items.find((c) => c.id === "c1").name).toBe("Ram");
  });

  it("7. an archive refused because of draft-bill Pheera (409) is passed on and the customer stays active", async () => {
    const err = conflict("Pheera of this customer are in a draft bill. Finish or discard that draft first");
    const store = createCustomerStore(fakeApi({ archiveCustomer: vi.fn().mockRejectedValue(err) }));
    await store.load();
    await expect(store.archive("c1", "Closed")).rejects.toMatchObject({ status: 409, message: expect.stringContaining("draft bill") });
    expect(store.getState().items.find((c) => c.id === "c1").isArchived).toBe(false);
  });

  it("archive moves the customer to archived (never a delete: it is still in the list)", async () => {
    const api = fakeApi();
    const store = createCustomerStore(api);
    await store.load();
    await store.archive("c1", "Closed shop");
    expect(api.archiveCustomer).toHaveBeenCalledWith("c1", "Closed shop");
    expect(store.getState().items).toHaveLength(3);
    expect(store.getState().items.find((c) => c.id === "c1").isArchived).toBe(true);
  });

  it("8. restore makes an archived customer active again from the server's answer", async () => {
    const store = createCustomerStore(fakeApi());
    await store.load();
    await store.restore("c3");
    expect(store.getState().items.find((c) => c.id === "c3").isArchived).toBe(false);
  });

  it("8b. a restore refused (a customer with that name exists now, 409) leaves it archived", async () => {
    const err = conflict('A customer named "Old" already exists', [{ field: "name", message: "Name already exists" }]);
    const store = createCustomerStore(fakeApi({ restoreCustomer: vi.fn().mockRejectedValue(err) }));
    await store.load();
    await expect(store.restore("c3")).rejects.toBe(err);
    expect(store.getState().items.find((c) => c.id === "c3").isArchived).toBe(true);
  });

  it("10. enabling Internal / No Bill adds it once (no duplicate on a second call) and is never claimed as 'created'", async () => {
    const store = createCustomerStore(fakeApi());
    await store.load();
    await store.enableInternal();
    await store.enableInternal();
    expect(store.getState().items.filter((c) => c.isInternal)).toHaveLength(1);
  });

  it("11/12/13. the Pheera choices come from the same list: normal active customers only; Internal separate; archived never", async () => {
    const store = createCustomerStore(fakeApi());
    await store.load();
    await store.enableInternal();
    const { customers, internal } = splitCustomers(store.getState().items);
    expect(customers.map((c) => c.name)).toEqual(["Ram", "Zed"]);
    expect(internal.name).toBe("Internal / No Bill");
    expect(customers.some((c) => c.isInternal || c.isArchived)).toBe(false);
    await store.archive("c1", "Closed");
    expect(splitCustomers(store.getState().items).customers.map((c) => c.name)).toEqual(["Zed"]); // archiving removes it from new-Pheera choices at once
  });
});

describe("customer store over the REAL service with a stubbed fetch", () => {
  it("2/4/6. paths, methods and bodies: list with archived, create, archive with the reason in the body, restore", async () => {
    const fetchMock = stubFetch();
    fetchMock.mockResolvedValueOnce(ok([dto(), dto({ id: "c3", name: "Old", isArchived: true })], { page: 1, limit: 500, total: 2 }));
    const store = createCustomerStore(realApi);
    await store.load();
    expect(call(fetchMock)).toMatchObject({ method: "GET", path: "/api/customers", query: { includeArchived: "true", limit: "500" } });
    fetchMock.mockResolvedValueOnce(ok(dto({ id: "c9", name: "New Co" }), undefined, 201));
    await store.create({ name: " New Co ", contact: "" });
    expect(call(fetchMock, 1)).toMatchObject({ method: "POST", path: "/api/customers", body: { name: "New Co" } });
    fetchMock.mockResolvedValueOnce(ok(dto({ isArchived: true, revision: 2 })));
    await store.archive("c1", " Closed shop ");
    expect(call(fetchMock, 2)).toMatchObject({ method: "DELETE", path: "/api/customers/c1", body: { reason: "Closed shop" } });
    fetchMock.mockResolvedValueOnce(ok(dto({ id: "c3", name: "Old", revision: 3 })));
    await store.restore("c3");
    expect(call(fetchMock, 3)).toMatchObject({ method: "POST", path: "/api/customers/c3/restore" });
  });

  it("an Internal customer archive refused by the server (409) is passed on", async () => {
    const fetchMock = stubFetch();
    fetchMock.mockResolvedValueOnce(fail(409, '"Internal / No Bill" is a built-in customer and cannot be archived'));
    const store = createCustomerStore(realApi);
    await expect(store.archive("i1", "No longer")).rejects.toMatchObject({ status: 409, message: expect.stringContaining("built-in") });
  });
});
