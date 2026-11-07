// Pure (no React) rules for the sign-in state, so they can be tested without a browser.
//
// status:  "loading"          asking the server who is signed in (first page load, or after Retry)
//          "authenticated"    a valid session; `user` is set
//          "unauthenticated"  no valid session; `expired` is true when a session that existed has just ended
//          "error"            the server could not be reached or answered badly; we do NOT know if there is a session

export const AUTH_STATUS = Object.freeze({
  LOADING: "loading",
  AUTHENTICATED: "authenticated",
  UNAUTHENTICATED: "unauthenticated",
  ERROR: "error",
});

export const initialAuthState = Object.freeze({ status: AUTH_STATUS.LOADING, user: null, expired: false, errorMessage: "" });

export function authReducer(state, action) {
  switch (action.type) {
    case "SESSION_LOADED":
      // Only the first check may decide this; a late answer must not undo a sign-in or sign-out that happened meanwhile.
      if (state.status !== AUTH_STATUS.LOADING) return state;
      return action.user
        ? { status: AUTH_STATUS.AUTHENTICATED, user: action.user, expired: false, errorMessage: "" }
        : { status: AUTH_STATUS.UNAUTHENTICATED, user: null, expired: false, errorMessage: "" };
    case "SESSION_FAILED":
      if (state.status !== AUTH_STATUS.LOADING) return state;
      return { status: AUTH_STATUS.ERROR, user: null, expired: false, errorMessage: action.message || "" };
    case "RETRY":
      return state.status === AUTH_STATUS.ERROR ? { ...initialAuthState } : state;
    case "LOGIN_SUCCESS":
      return { status: AUTH_STATUS.AUTHENTICATED, user: action.user, expired: false, errorMessage: "" };
    case "LOGGED_OUT":
      return { status: AUTH_STATUS.UNAUTHENTICATED, user: null, expired: false, errorMessage: "" };
    case "SESSION_EXPIRED":
      // Several requests can fail together; only a signed-in session can expire, and repeats change nothing.
      return state.status === AUTH_STATUS.AUTHENTICATED ? { status: AUTH_STATUS.UNAUTHENTICATED, user: null, expired: true, errorMessage: "" } : state;
    default:
      return state;
  }
}

/** What a guarded route should do for this state: show "loading" or "error", "redirect" to the login page, or "allow". */
export function resolveGuard({ status }) {
  switch (status) {
    case AUTH_STATUS.AUTHENTICATED:
      return "allow";
    case AUTH_STATUS.UNAUTHENTICATED:
      return "redirect";
    case AUTH_STATUS.ERROR:
      return "error";
    default:
      return "loading";
  }
}

/**
 * Where to go after signing in. Accepts the `from` location a guarded route stored (or a string). Only an in-app path is
 * accepted: never another site, never the login page itself. Anything else gives the fallback.
 */
export function safeRedirectPath(from, fallback = "/dashboard") {
  const raw = typeof from === "string" ? from : from && typeof from.pathname === "string" ? `${from.pathname}${from.search ?? ""}${from.hash ?? ""}` : "";
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) return fallback;
  if (/[\u0000-\u001f]/.test(raw)) return fallback;
  if (raw === "/login" || raw.startsWith("/login?") || raw.startsWith("/login/") || raw.startsWith("/login#")) return fallback;
  return raw;
}

const ROLE_LABELS = Object.freeze({ OWNER: "Owner", MANAGER: "Manager", STAFF: "Staff" });
export const roleLabel = (role) => ROLE_LABELS[role] ?? "User";

export const firstName = (user) => String(user?.name ?? "").trim().split(/\s+/)[0] || "there";

export const initialsOf = (name) =>
  String(name ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase() || "?";
