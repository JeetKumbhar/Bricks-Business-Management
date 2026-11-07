import { createContext, useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { AUTH_STATUS, authReducer, initialAuthState } from "../features/auth/authState";
import { getErrorMessage, setUnauthorizedHandler } from "../services/api";
import * as authService from "../services/authService";

export const AuthContext = createContext(null);

/**
 * Who is signed in. The session itself is the backend's httpOnly cookie (JavaScript cannot read it), so the only way to
 * know whether it is valid is to ask GET /api/auth/me. That happens once when the app opens and again after "Retry".
 * Nothing about the session is kept in localStorage.
 */
export function AuthProvider({ children }) {
  const [state, dispatch] = useReducer(authReducer, initialAuthState);
  const [attempt, setAttempt] = useState(0); // changing it re-runs the session check
  const logoutInFlight = useRef(null);

  // Ask the server who is signed in (on open, and again after Retry).
  useEffect(() => {
    const controller = new AbortController();
    authService
      .getCurrentUser({ signal: controller.signal })
      .then((user) => dispatch({ type: "SESSION_LOADED", user }))
      .catch((err) => {
        if (controller.signal.aborted) return;
        dispatch({ type: "SESSION_FAILED", message: getErrorMessage(err, "Could not check your session.") });
      });
    return () => controller.abort();
  }, [attempt]);

  // Any later request that comes back 401 means the session ended (expired, or signed out elsewhere).
  useEffect(() => setUnauthorizedHandler(() => dispatch({ type: "SESSION_EXPIRED" })), []);

  /** Throws an ApiError when the sign-in is refused (wrong password, too many attempts, server down...). */
  const login = useCallback(async (email, password) => {
    const user = await authService.login(email, password);
    dispatch({ type: "LOGIN_SUCCESS", user });
    return user;
  }, []);

  /** Resolves { ok: true }, or { ok: false, message } when the server could not be told (the session then stays open, so nobody is shown as signed out while the cookie is still valid). */
  const logout = useCallback(() => {
    if (logoutInFlight.current) return logoutInFlight.current;
    logoutInFlight.current = authService
      .logout()
      .then(() => {
        dispatch({ type: "LOGGED_OUT" });
        return { ok: true };
      })
      .catch((err) => ({ ok: false, message: getErrorMessage(err, "Could not sign out. Please try again.") }))
      .finally(() => {
        logoutInFlight.current = null;
      });
    return logoutInFlight.current;
  }, []);

  const retry = useCallback(() => {
    dispatch({ type: "RETRY" });
    setAttempt((n) => n + 1);
  }, []);

  const value = useMemo(
    () => ({
      status: state.status,
      user: state.user,
      expired: state.expired,
      errorMessage: state.errorMessage,
      isAuthenticated: state.status === AUTH_STATUS.AUTHENTICATED,
      login,
      logout,
      retry,
    }),
    [state, login, logout, retry]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
