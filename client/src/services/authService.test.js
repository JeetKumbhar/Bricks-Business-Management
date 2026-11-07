import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, setUnauthorizedHandler } from "./api";
import { getCurrentUser, login, logout } from "./authService";

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const USER = { id: "665f1c2e9b1e8a0012345678", name: "Ramesh Patel", email: "owner@example.com", role: "OWNER" };

let fetchMock;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  setUnauthorizedHandler(null);
  vi.unstubAllGlobals();
});

describe("authService", () => {
  it("login posts email and password to /api/auth/login and returns the user", async () => {
    fetchMock.mockResolvedValue(json(200, { success: true, message: "Logged in successfully", data: { user: USER } }));
    const user = await login("owner@example.com", "a long password 123");
    expect(user).toEqual(USER);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/auth/login");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ email: "owner@example.com", password: "a long password 123" });
    expect(init.credentials).toBe("include");
  });

  it("a wrong password rejects with the server message and does not look like an expired session", async () => {
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    fetchMock.mockResolvedValue(json(401, { success: false, message: "Invalid email or password" }));
    const err = await login("owner@example.com", "wrong").catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(401);
    expect(err.message).toBe("Invalid email or password");
    expect(handler).not.toHaveBeenCalled();
  });

  it("logout posts to /api/auth/logout with no body", async () => {
    fetchMock.mockResolvedValue(json(200, { success: true, message: "Logged out successfully", data: null }));
    await logout();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/auth/logout");
    expect(init.method).toBe("POST");
    expect(init.body).toBeUndefined();
  });

  it("getCurrentUser returns the user for a valid session", async () => {
    fetchMock.mockResolvedValue(json(200, { success: true, message: "Current user fetched successfully", data: { user: USER } }));
    expect(await getCurrentUser()).toEqual(USER);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/auth/me");
  });

  it("getCurrentUser returns null (not an error) when nobody is signed in, without triggering the expiry handler", async () => {
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    fetchMock.mockResolvedValue(json(401, { success: false, message: "Authentication required" }));
    expect(await getCurrentUser()).toBeNull();
    expect(handler).not.toHaveBeenCalled();
  });

  it("getCurrentUser still throws when the server cannot be reached, so it is not mistaken for 'signed out'", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    const err = await getCurrentUser().catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.isConnectionProblem).toBe(true);
  });

  it("getCurrentUser throws on a server error", async () => {
    fetchMock.mockResolvedValue(json(500, { success: false, message: "Something went wrong on the server" }));
    const err = await getCurrentUser().catch((e) => e);
    expect(err.status).toBe(500);
  });
});
