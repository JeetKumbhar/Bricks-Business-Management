import { describe, expect, it, vi } from "vitest";

// A frontend on another site (e.g. *.vercel.app) needs SameSite=None, which browsers only accept together with Secure.
vi.hoisted(() => {
  process.env.NODE_ENV = "test";
  process.env.COOKIE_SAME_SITE = "none";
  process.env.JWT_EXPIRES_IN = "30m";
});

const { setAuthCookie, clearAuthCookie, AUTH_COOKIE } = await import("../utils/authCookie.js");
const { signAccessToken } = await import("../services/auth.service.js");

const fakeRes = () => ({ cookie: vi.fn(), clearCookie: vi.fn() });

describe("auth cookie options", () => {
  it("is HTTP-only, Secure, SameSite=None, scoped to /api and expires with the token", () => {
    const res = fakeRes();
    setAuthCookie(res, signAccessToken({ id: "a".repeat(24), tokenVersion: 0 }));
    const [name, value, options] = res.cookie.mock.calls[0];
    expect(name).toBe(AUTH_COOKIE);
    expect(value.split(".")).toHaveLength(3);
    expect(options).toMatchObject({ httpOnly: true, secure: true, sameSite: "none", path: "/api" });
    const minutes = (options.expires.getTime() - Date.now()) / 60000;
    expect(minutes).toBeGreaterThan(29);
    expect(minutes).toBeLessThanOrEqual(30);
  });

  it("clears with exactly the same options, or the browser would keep the cookie", () => {
    const res = fakeRes();
    clearAuthCookie(res);
    expect(res.clearCookie).toHaveBeenCalledWith(AUTH_COOKIE, { httpOnly: true, secure: true, sameSite: "none", path: "/api" });
  });
});
