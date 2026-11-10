// MOCKED tests: ApiError objects are built by a stubbed fetch; no real server.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, setUnauthorizedHandler } from "./api";
import { ERROR_KIND, classifyApiError, groupRowErrors } from "./apiErrorKinds";
import { fail, stubFetch } from "./_mockHelpers";

let fetchMock;
beforeEach(() => { fetchMock = stubFetch(); });
afterEach(() => { vi.unstubAllGlobals(); setUnauthorizedHandler(null); });

const errorOf = async (response) => { fetchMock.mockResolvedValueOnce(response); return api.get("/x").then(() => null, (e) => e); };

describe("classifyApiError (mocked)", () => {
  it("400 is VALIDATION, keeps the server message and field list, nothing saved", async () => {
    const c = classifyApiError(await errorOf(fail(400, "Please fix the highlighted fields", [{ field: "quantity", message: "Quantity must be positive" }])));
    expect(c).toMatchObject({ kind: ERROR_KIND.VALIDATION, message: "Please fix the highlighted fields", nothingSaved: true, status: 400, fieldErrors: { quantity: "Quantity must be positive" } });
  });
  it("409 is CONFLICT; a 409 on a customerId field that says archived is ARCHIVED_CUSTOMER", async () => {
    expect(classifyApiError(await errorOf(fail(409, "Pheera is billed"))).kind).toBe(ERROR_KIND.CONFLICT);
    const c = classifyApiError(await errorOf(fail(409, "Customer is archived", [{ field: "trips.1.customerId", message: 'Customer "Ram" is archived' }])));
    expect(c.kind).toBe(ERROR_KIND.ARCHIVED_CUSTOMER);
    expect(c.fieldErrors["trips.1.customerId"]).toMatch(/archived/);
  });
  it("401, 403 and 404 are told apart", async () => {
    setUnauthorizedHandler(() => {});
    expect(classifyApiError(await errorOf(fail(401, "Please sign in"))).kind).toBe(ERROR_KIND.UNAUTHENTICATED);
    expect(classifyApiError(await errorOf(fail(403, "Owner only"))).kind).toBe(ERROR_KIND.FORBIDDEN);
    expect(classifyApiError(await errorOf(fail(404, "Not found"))).kind).toBe(ERROR_KIND.NOT_FOUND);
  });
  it("a 5xx or a lost connection is CONNECTION and is NOT 'nothing saved'", async () => {
    expect(classifyApiError(await errorOf(fail(503, "Down")))).toMatchObject({ kind: ERROR_KIND.CONNECTION, nothingSaved: false });
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const e = await api.get("/x").then(() => null, (err) => err);
    expect(classifyApiError(e)).toMatchObject({ kind: ERROR_KIND.CONNECTION, nothingSaved: false });
  });
  it("a plain Error is UNKNOWN", () => {
    expect(classifyApiError(new Error("boom"))).toMatchObject({ kind: ERROR_KIND.UNKNOWN, message: "boom", nothingSaved: false });
  });
});

describe("groupRowErrors (mocked)", () => {
  it("groups trips.N.field by row and keeps other errors as general; first message wins", async () => {
    const e = await errorOf(fail(400, "bad", [
      { field: "trips.0.customerId", message: "Unknown customer" },
      { field: "trips.0.customerId", message: "second" },
      { field: "trips.2.quantity", message: "Too big" },
      { field: "truckId", message: "Choose a truck" },
    ]));
    expect(groupRowErrors(e)).toEqual({ rows: { 0: { customerId: "Unknown customer" }, 2: { quantity: "Too big" } }, general: { truckId: "Choose a truck" } });
  });
  it("returns empty groups for non-API errors", () => {
    expect(groupRowErrors(new Error("x"))).toEqual({ rows: {}, general: {} });
  });
});
