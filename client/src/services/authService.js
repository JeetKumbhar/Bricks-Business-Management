// Sign-in, sign-out and "who am I" against the existing backend (server/routes/auth.routes.js):
//   POST /api/auth/login   { email, password } -> { success, message, data: { user } } and sets the httpOnly cookie
//   POST /api/auth/logout  (no body)           -> { success, message }; clears the cookie; safe to call at any time
//   GET  /api/auth/me                          -> { success, message, data: { user } }, or 401 when not signed in
// user = { id, name, email, role }, role is "OWNER" | "MANAGER" | "STAFF".
import { api, ApiError } from "./api";

// These calls handle a 401 themselves, so a wrong password or "not signed in yet" is not treated as an expired session.
const own = { skipUnauthorizedHandler: true };

export async function login(email, password) {
  const { data } = await api.post("/auth/login", { email, password }, own);
  return data.user;
}

export async function logout() {
  await api.post("/auth/logout", undefined, own);
}

/** The signed-in user, or null when there is no valid session. Other failures (server down, 5xx) still throw. */
export async function getCurrentUser({ signal } = {}) {
  try {
    const { data } = await api.get("/auth/me", { ...own, signal });
    return data.user;
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return null;
    throw err;
  }
}
