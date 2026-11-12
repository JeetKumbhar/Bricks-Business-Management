import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { NetworkError, createHttp, createReport, describeNetworkError, isTransientNetworkError, sanitize } from "../scripts/lib/phase4Http.js";

const netError = (code) => Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error(`connect ${code}`), { code }) });
const okResponse = (status = 200, body = { success: true, data: { ok: 1 } }) => ({ status, headers: { getSetCookie: () => [] }, json: async () => body });
const make = (fetchImpl, extra = {}) => createHttp({ baseUrl: "http://x/api", origin: "http://o", fetchImpl, sleep: async () => {}, retryDelayMs: 1, ...extra });

describe("retry rules", () => {
  it("retries a GET after a transient network failure and then succeeds", async () => {
    const fetchImpl = vi.fn().mockRejectedValueOnce(netError("ECONNRESET")).mockRejectedValueOnce(netError("ECONNREFUSED")).mockResolvedValueOnce(okResponse());
    const onRetry = vi.fn();
    const res = await make(fetchImpl, { onRetry }).call("GET", "/customers");
    expect(res.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(onRetry).toHaveBeenCalledTimes(2);
  });

  it("stops after the bounded number of attempts and names the request", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(netError("ECONNREFUSED"));
    const error = await make(fetchImpl).call("GET", "/customers").catch((e) => e);
    expect(error).toBeInstanceOf(NetworkError);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(error.message).toMatch(/GET \/customers failed \(ECONNREFUSED\) after 3 attempts/);
    expect(error.uncertain).toBe(false);
  });

  it.each(["POST", "PATCH", "PUT", "DELETE"])("never retries %s after a network failure, and marks the outcome uncertain", async (method) => {
    const fetchImpl = vi.fn().mockRejectedValue(netError("ECONNRESET"));
    const error = await make(fetchImpl).call(method, "/bills", { a: 1 }).catch((e) => e);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(error).toBeInstanceOf(NetworkError);
    expect(error.uncertain).toBe(true);
    expect(error.attempts).toBe(1);
  });

  it("does not retry an HTTP error answer (that is an application result)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse(500, { success: false, message: "boom" }));
    const res = await make(fetchImpl).call("GET", "/customers");
    expect(res.status).toBe(500);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("does not retry a non-network error thrown by fetch", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new RangeError("bad"));
    await expect(make(fetchImpl).call("GET", "/x")).rejects.toBeInstanceOf(NetworkError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("timeouts", () => {
  it("passes an abort signal, and a timeout is reported as TIMEOUT (GET retried, POST not)", async () => {
    const timeout = Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
    const seen = [];
    const fetchImpl = vi.fn(async (_url, init) => {
      seen.push(init.signal instanceof AbortSignal);
      throw timeout;
    });
    const get = await make(fetchImpl).call("GET", "/slow").catch((e) => e);
    expect(get.timedOut).toBe(true);
    expect(get.message).toMatch(/GET \/slow timed out after 3 attempts/);
    const before = fetchImpl.mock.calls.length;
    const post = await make(fetchImpl).call("POST", "/slow", {}).catch((e) => e);
    expect(fetchImpl.mock.calls.length - before).toBe(1);
    expect(post.uncertain).toBe(true);
    expect(seen.every(Boolean)).toBe(true);
  });
});

describe("diagnostics never contain secrets", () => {
  it("sanitize hides passwords, cookies, tokens and connection strings", () => {
    const text = sanitize('password: "Hunter2xx" brickpro_token=abc.def.ghi mongodb+srv://u:pw@h.net/db?x=1 Authorization: Bearer zzz plain Hunter2xx', ["Hunter2xx"]);
    expect(text).not.toMatch(/Hunter2xx|abc\.def|u:pw|Bearer zzz/);
  });

  it("a NetworkError message built from a hostile error text is sanitized", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error("mongodb://user:SECRETPW@host/db leaked, secret=SECRETPW"), { code: "ECONNRESET" }) }));
    const error = await make(fetchImpl, { secrets: ["SECRETPW"] }).call("POST", "/auth/login", { password: "SECRETPW" }).catch((e) => e);
    expect(error.message).not.toMatch(/SECRETPW|user:/);
  });

  it("describeNetworkError and isTransientNetworkError read the cause code", () => {
    expect(describeNetworkError(netError("ECONNRESET")).code).toBe("ECONNRESET");
    expect(isTransientNetworkError(netError("ECONNRESET"))).toBe(true);
    expect(isTransientNetworkError(new RangeError("x"))).toBe(false);
  });
});

describe("backend probe and cookies", () => {
  it("probeBackend reports reachable / unreachable without retrying", async () => {
    const up = make(vi.fn().mockResolvedValue(okResponse()));
    expect(await up.probeBackend()).toEqual({ reachable: true, status: 200 });
    const fetchDown = vi.fn().mockRejectedValue(netError("ECONNREFUSED"));
    expect(await make(fetchDown).probeBackend()).toEqual({ reachable: false, code: "ECONNREFUSED" });
    expect(fetchDown).toHaveBeenCalledTimes(1);
  });

  it("keeps the login cookie and sends it later, but not when noCookie is set", async () => {
    const login = { status: 200, headers: { getSetCookie: () => ["brickpro_token=T0K; Path=/; HttpOnly"] }, json: async () => ({ success: true }) };
    const fetchImpl = vi.fn().mockResolvedValueOnce(login).mockResolvedValue(okResponse());
    const http = make(fetchImpl);
    await http.call("POST", "/auth/login", {});
    await http.call("GET", "/auth/me");
    await http.call("GET", "/health", undefined, { noCookie: true });
    expect(fetchImpl.mock.calls[1][1].headers.Cookie).toBe("brickpro_token=T0K");
    expect(fetchImpl.mock.calls[2][1].headers.Cookie).toBeUndefined();
    expect(http.hasCookie()).toBe(true);
  });
});

describe("report", () => {
  it("counts passed, failed, skipped and inconclusive separately and sets the exit code", () => {
    const r = createReport(() => {});
    r.check("a", true);
    expect(r.exitCode()).toBe(0);
    r.skip("b", "no seller details");
    expect(r.exitCode()).toBe(0);
    r.inconclusive("POST /x", "unknown");
    expect(r.exitCode()).toBe(3);
    r.check("c", false, "bad");
    expect(r.exitCode()).toBe(1);
    expect(r.counts).toEqual({ passed: 1, failed: 1, skipped: 1, inconclusive: 1 });
  });
});

describe("session cookie (regression: 'cookie is not defined' after the 401 check)", () => {
  const loginResponse = { status: 200, headers: { getSetCookie: () => ["brickpro_token=T0K; Path=/; HttpOnly; SameSite=Lax"] }, json: async () => ({ success: true }) };
  const cookieOf = (fetchImpl, n) => fetchImpl.mock.calls[n][1].headers.Cookie;

  it("sends no cookie before login and hasCookie() is false", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse());
    const http = make(fetchImpl);
    await http.call("GET", "/customers");
    expect(cookieOf(fetchImpl, 0)).toBeUndefined();
    expect(http.hasCookie()).toBe(false);
  });

  it("a login without a session cookie leaves hasCookie() false (login must then be reported as failed)", async () => {
    const http = make(vi.fn().mockResolvedValue(okResponse(401, { success: false })));
    await http.call("POST", "/auth/login", {});
    expect(http.hasCookie()).toBe(false);
  });

  it("captures the cookie from the login response and sends exactly that cookie afterwards, including on file downloads", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(loginResponse).mockResolvedValue({ ...okResponse(), headers: { getSetCookie: () => [], get: () => "application/pdf" }, arrayBuffer: async () => new ArrayBuffer(2048) });
    const http = make(fetchImpl);
    await http.call("POST", "/auth/login", { email: "a@b.c", password: "x" });
    expect(cookieOf(fetchImpl, 0)).toBeUndefined(); // the login itself carries no cookie
    expect(http.hasCookie()).toBe(true);
    await http.call("GET", "/auth/me");
    const pdf = await http.call("GET", "/bills/1/pdf", undefined, { raw: true });
    expect(cookieOf(fetchImpl, 1)).toBe("brickpro_token=T0K");
    expect(cookieOf(fetchImpl, 2)).toBe("brickpro_token=T0K");
    expect(pdf).toEqual({ status: 200, contentType: "application/pdf", byteLength: 2048 });
  });

  it("a request made with noCookie never carries the session cookie, even after login", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(loginResponse).mockResolvedValue(okResponse(401, { success: false }));
    const http = make(fetchImpl);
    await http.call("POST", "/auth/login", {});
    await http.call("GET", "/customers", undefined, { noCookie: true });
    expect(cookieOf(fetchImpl, 1)).toBeUndefined();
    expect(http.hasCookie()).toBe(true);
  });

  it("the cookie value never appears in a network error message", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(loginResponse).mockRejectedValue(Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error("reset while sending brickpro_token=T0K"), { code: "ECONNRESET" }) }));
    const http = make(fetchImpl);
    await http.call("POST", "/auth/login", {});
    const error = await http.call("POST", "/bills", {}).catch((e) => e);
    expect(error.message).not.toContain("T0K");
  });

  it("verifyPhase4.js has no stray reference to a module-level 'cookie' variable and no raw fetch() of its own", () => {
    const source = readFileSync(new URL("../scripts/verifyPhase4.js", import.meta.url), "utf8");
    expect(source).not.toMatch(/\bcookie\b/);
    expect(source).not.toMatch(/(^|[^.\w])fetch\(/m);
  });
});
