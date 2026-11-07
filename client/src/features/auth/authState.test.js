import { describe, expect, it } from "vitest";
import { AUTH_STATUS, authReducer, firstName, initialAuthState, initialsOf, resolveGuard, roleLabel, safeRedirectPath } from "./authState";

const USER = { id: "1", name: "Ramesh Patel", email: "owner@example.com", role: "OWNER" };
const run = (actions, start = initialAuthState) => actions.reduce(authReducer, start);

describe("authReducer", () => {
  it("starts in loading", () => {
    expect(initialAuthState.status).toBe(AUTH_STATUS.LOADING);
  });

  it("first check: signed in / not signed in / server problem", () => {
    expect(run([{ type: "SESSION_LOADED", user: USER }])).toMatchObject({ status: "authenticated", user: USER });
    expect(run([{ type: "SESSION_LOADED", user: null }])).toMatchObject({ status: "unauthenticated", user: null, expired: false });
    expect(run([{ type: "SESSION_FAILED", message: "down" }])).toMatchObject({ status: "error", errorMessage: "down" });
  });

  it("a late first-check answer never undoes a sign-in or sign-out", () => {
    const signedIn = run([{ type: "LOGIN_SUCCESS", user: USER }, { type: "SESSION_LOADED", user: null }]);
    expect(signedIn.status).toBe("authenticated");
    const signedOut = run([{ type: "LOGGED_OUT" }, { type: "SESSION_LOADED", user: USER }]);
    expect(signedOut.status).toBe("unauthenticated");
  });

  it("retry goes from error back to loading, and does nothing in other states", () => {
    const failed = run([{ type: "SESSION_FAILED", message: "down" }]);
    expect(authReducer(failed, { type: "RETRY" }).status).toBe("loading");
    const ok = run([{ type: "SESSION_LOADED", user: USER }]);
    expect(authReducer(ok, { type: "RETRY" })).toBe(ok);
  });

  it("login then logout", () => {
    expect(run([{ type: "LOGIN_SUCCESS", user: USER }])).toMatchObject({ status: "authenticated", user: USER });
    expect(run([{ type: "LOGIN_SUCCESS", user: USER }, { type: "LOGGED_OUT" }])).toMatchObject({ status: "unauthenticated", user: null, expired: false });
  });

  it("an expired session clears the user and says so; repeats change nothing", () => {
    const expired = run([{ type: "LOGIN_SUCCESS", user: USER }, { type: "SESSION_EXPIRED" }]);
    expect(expired).toMatchObject({ status: "unauthenticated", user: null, expired: true });
    expect(authReducer(expired, { type: "SESSION_EXPIRED" })).toBe(expired);
  });

  it("an expiry signal while not signed in is ignored (for example a late 401 after logout)", () => {
    const out = run([{ type: "LOGGED_OUT" }]);
    expect(authReducer(out, { type: "SESSION_EXPIRED" })).toBe(out);
    expect(authReducer(out, { type: "SESSION_EXPIRED" }).expired).toBe(false);
  });

  it("signing in again clears the expired flag", () => {
    const s = run([{ type: "LOGIN_SUCCESS", user: USER }, { type: "SESSION_EXPIRED" }, { type: "LOGIN_SUCCESS", user: USER }]);
    expect(s).toMatchObject({ status: "authenticated", expired: false });
  });
});

describe("resolveGuard", () => {
  it("allows only a signed-in user; sends everyone else to login, a status screen, or the error screen", () => {
    expect(resolveGuard({ status: "authenticated" })).toBe("allow");
    expect(resolveGuard({ status: "unauthenticated" })).toBe("redirect");
    expect(resolveGuard({ status: "loading" })).toBe("loading");
    expect(resolveGuard({ status: "error" })).toBe("error");
    expect(resolveGuard({ status: "anything-unknown" })).toBe("loading");
  });

  it("never allows protected content while the session is unknown or the server is unreachable", () => {
    for (const status of ["loading", "error", "unauthenticated"]) expect(resolveGuard({ status })).not.toBe("allow");
  });
});

describe("safeRedirectPath", () => {
  it("accepts an in-app location object or string", () => {
    expect(safeRedirectPath({ pathname: "/payments", search: "?tab=history", hash: "#x" })).toBe("/payments?tab=history#x");
    expect(safeRedirectPath("/labours/L-001")).toBe("/labours/L-001");
  });

  it("falls back for anything that could leave the app or loop", () => {
    for (const bad of ["https://evil.example", "//evil.example", "/\\evil.example", "javascript:alert(1)", "evil", "", undefined, null, "/login", "/login?x=1", "/login/", "/a\nb", { pathname: "//evil" }]) {
      expect(safeRedirectPath(bad)).toBe("/dashboard");
    }
    expect(safeRedirectPath("/loginhistory")).toBe("/loginhistory");
  });

  it("uses a custom fallback", () => {
    expect(safeRedirectPath(undefined, "/x")).toBe("/x");
  });
});

describe("display helpers", () => {
  it("roleLabel", () => {
    expect(roleLabel("OWNER")).toBe("Owner");
    expect(roleLabel("MANAGER")).toBe("Manager");
    expect(roleLabel("STAFF")).toBe("Staff");
    expect(roleLabel("???")).toBe("User");
    expect(roleLabel(undefined)).toBe("User");
  });

  it("firstName and initialsOf cope with missing names", () => {
    expect(firstName(USER)).toBe("Ramesh");
    expect(firstName(null)).toBe("there");
    expect(firstName({ name: "   " })).toBe("there");
    expect(initialsOf("Ramesh Patel")).toBe("RP");
    expect(initialsOf("  ramesh  kumar  patel ")).toBe("RK");
    expect(initialsOf("")).toBe("?");
    expect(initialsOf(undefined)).toBe("?");
  });
});
