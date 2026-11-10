// Static-markup tests (react-dom/server, no browser): who sees what, and that the data stores are created ONLY for a signed-in person.
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthContext } from "../context/AuthContext";

const mounted = vi.hoisted(() => ({ providers: 0 }));
vi.mock("./AppDataProviders", async () => {
  const { Outlet } = await import("react-router-dom");
  return { default: () => { mounted.providers += 1; return <Outlet />; } };
});
vi.mock("../layouts/MainLayout", async () => {
  const { Outlet } = await import("react-router-dom");
  return { default: () => <main data-testid="app"><Outlet /></main> };
});
vi.mock("../pages/Dashboard", () => ({ default: () => <p>DASHBOARD PAGE</p> }));

import AppRoutes from "./AppRoutes";

const auth = (status, extra = {}) => ({ status, user: status === "authenticated" ? { name: "Owner" } : null, expired: false, errorMessage: "", isAuthenticated: status === "authenticated", login: async () => {}, logout: async () => ({ ok: true }), retry: () => {}, ...extra });
const at = (path, value) => renderToStaticMarkup(<AuthContext.Provider value={value}><MemoryRouter initialEntries={[path]}><AppRoutes /></MemoryRouter></AuthContext.Provider>);

beforeEach(() => { mounted.providers = 0; });

describe("routes and sign-in (static markup)", () => {
  it("signed in: the page is shown and the data stores are created", () => {
    const html = at("/dashboard", auth("authenticated"));
    expect(html).toContain("DASHBOARD PAGE");
    expect(mounted.providers).toBe(1);
  });
  it("not signed in: no page, and the data stores are NOT created (so nothing is requested and there are no 401s)", () => {
    const html = at("/dashboard", auth("unauthenticated"));
    expect(html).not.toContain("DASHBOARD PAGE");
    expect(mounted.providers).toBe(0);
  });
  it("while the session is being checked: a status screen, no page, no data stores", () => {
    const html = at("/dashboard", auth("loading"));
    expect(html).toContain("Checking your session");
    expect(html).not.toContain("DASHBOARD PAGE");
    expect(mounted.providers).toBe(0);
  });
  it("server unreachable while checking the session: a clear message with Try again, no data stores", () => {
    const html = at("/dashboard", auth("error", { errorMessage: "Could not check your session." }));
    expect(html).toContain("Cannot reach the server");
    expect(html).toContain("Try again");
    expect(mounted.providers).toBe(0);
  });
  it("the login page is shown to someone who is not signed in, and creates no data stores", () => {
    const html = at("/login", auth("unauthenticated"));
    expect(html).toMatch(/Sign in/i);
    expect(html).toMatch(/type="password"/);
    expect(mounted.providers).toBe(0);
  });
});
