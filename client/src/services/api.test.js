import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, API_ERROR_CODES, api, getErrorMessage, getFieldErrors, setUnauthorizedHandler } from "./api";

const json = (status, body, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

let fetchMock;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  setUnauthorizedHandler(null);
  vi.unstubAllGlobals();
});

describe("api client: requests", () => {
  it("calls a relative /api URL with the login cookie and JSON headers", async () => {
    fetchMock.mockResolvedValue(json(200, { success: true, message: "ok", data: [1] }));
    await api.get("/labours", { query: { type: "BIGARI", empty: "", none: undefined } });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/labours?type=BIGARI");
    expect(init.method).toBe("GET");
    expect(init.credentials).toBe("include");
    expect(init.headers.Accept).toBe("application/json");
    expect(init.body).toBeUndefined();
  });

  it("sends a JSON body with a Content-Type", async () => {
    fetchMock.mockResolvedValue(json(201, { success: true, message: "ok", data: null }));
    await api.post("/payments", { amount: 10 });
    const [, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe("POST");
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(init.body).toBe('{"amount":10}');
  });

  it("returns the whole envelope so callers can read data and meta", async () => {
    fetchMock.mockResolvedValue(json(200, { success: true, message: "ok", data: [1], meta: { total: 1 } }));
    const res = await api.get("labours");
    expect(res.data).toEqual([1]);
    expect(res.meta).toEqual({ total: 1 });
    expect(fetchMock.mock.calls[0][0]).toBe("/api/labours");
  });
});

describe("api client: errors", () => {
  it("turns an API error into an ApiError with status, message and field errors", async () => {
    fetchMock.mockResolvedValue(json(400, { success: false, message: "Validation failed", errors: [{ field: "email", message: "Enter a valid email address" }] }));
    const err = await api.post("/auth/login", {}, { skipUnauthorizedHandler: true }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(400);
    expect(err.message).toBe("Validation failed");
    expect(getFieldErrors(err)).toEqual({ email: "Enter a valid email address" });
    expect(err.isConnectionProblem).toBe(false);
  });

  it("reports an unreachable server as a connection problem", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    const err = await api.get("/labours").catch((e) => e);
    expect(err.code).toBe(API_ERROR_CODES.NETWORK);
    expect(err.status).toBe(0);
    expect(err.isConnectionProblem).toBe(true);
    expect(getErrorMessage(err)).toMatch(/Cannot reach the server/);
  });

  it("reports a slow server as a timeout", async () => {
    fetchMock.mockImplementation((_url, init) => new Promise((_res, rej) => init.signal.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError")))));
    const err = await api.get("/labours", { timeoutMs: 20 }).catch((e) => e);
    expect(err.code).toBe(API_ERROR_CODES.TIMEOUT);
    expect(err.isConnectionProblem).toBe(true);
  });

  it("does not report a call the screen cancelled itself as an error to show", async () => {
    const controller = new AbortController();
    fetchMock.mockImplementation((_url, init) => new Promise((_res, rej) => init.signal.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError")))));
    const pending = api.get("/labours", { signal: controller.signal }).catch((e) => e);
    controller.abort();
    const err = await pending;
    expect(err).not.toBeInstanceOf(ApiError);
    expect(err.name).toBe("AbortError");
  });

  it("rejects an HTML page (for example /api not proxied, so index.html came back) instead of treating it as data", async () => {
    fetchMock.mockResolvedValue(new Response("<!doctype html><html></html>", { status: 200, headers: { "content-type": "text/html" } }));
    const err = await api.get("/labours").catch((e) => e);
    expect(err.code).toBe(API_ERROR_CODES.BAD_RESPONSE);
    expect(err.isConnectionProblem).toBe(true);
  });

  it("rejects a proxy error page (502) as a bad response", async () => {
    fetchMock.mockResolvedValue(new Response("Bad Gateway", { status: 502, headers: { "content-type": "text/plain" } }));
    const err = await api.get("/labours").catch((e) => e);
    expect(err.code).toBe(API_ERROR_CODES.BAD_RESPONSE);
    expect(err.status).toBe(502);
  });

  it("rejects JSON that is not the API envelope", async () => {
    fetchMock.mockResolvedValue(json(200, { hello: "world" }));
    const err = await api.get("/labours").catch((e) => e);
    expect(err.code).toBe(API_ERROR_CODES.BAD_RESPONSE);
  });

  it("passes the server's message through for 429 and 500", async () => {
    fetchMock.mockResolvedValueOnce(json(429, { success: false, message: "Too many login attempts. Please try again later." }));
    expect((await api.post("/auth/login", {}).catch((e) => e)).message).toBe("Too many login attempts. Please try again later.");
    fetchMock.mockResolvedValueOnce(json(500, { success: false, message: "Something went wrong on the server" }));
    const err = await api.get("/labours").catch((e) => e);
    expect(err.status).toBe(500);
    expect(err.isConnectionProblem).toBe(true);
  });

  it("getErrorMessage falls back for errors that are not ApiErrors", () => {
    expect(getErrorMessage(new Error("boom"), "fallback")).toBe("fallback");
  });
});

describe("api client: expired session (401)", () => {
  it("calls the unauthorized handler when a protected request is refused", async () => {
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    fetchMock.mockResolvedValue(json(401, { success: false, message: "Authentication required" }));
    const err = await api.get("/labours").catch((e) => e);
    expect(err.status).toBe(401);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("does not call it for the sign-in flow's own requests", async () => {
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    fetchMock.mockResolvedValue(json(401, { success: false, message: "Invalid email or password" }));
    await api.post("/auth/login", {}, { skipUnauthorizedHandler: true }).catch(() => {});
    expect(handler).not.toHaveBeenCalled();
  });

  it("does not call it for other statuses, and the returned cleanup removes the handler", async () => {
    const handler = vi.fn();
    const remove = setUnauthorizedHandler(handler);
    fetchMock.mockResolvedValueOnce(json(403, { success: false, message: "You do not have permission to do this" }));
    await api.get("/labours").catch(() => {});
    expect(handler).not.toHaveBeenCalled();
    remove();
    fetchMock.mockResolvedValueOnce(json(401, { success: false, message: "Authentication required" }));
    await api.get("/labours").catch(() => {});
    expect(handler).not.toHaveBeenCalled();
  });
});
