// The login token lives in an HTTP-only cookie, so page JavaScript (and therefore any injected script) cannot read it.
import { env } from "../config/env.js";
import { tokenExpiry } from "../services/auth.service.js";

export const AUTH_COOKIE = "brickpro_token";

// The same options must be used to set and to clear a cookie, or the browser keeps the old one.
const baseOptions = () => ({
  httpOnly: true,
  secure: env.cookieSecure,
  sameSite: env.cookieSameSite,
  path: "/api", // sent only to the API, never to static files
});

export const setAuthCookie = (res, token) => {
  const expires = tokenExpiry(token);
  res.cookie(AUTH_COOKIE, token, { ...baseOptions(), ...(expires ? { expires } : {}) });
};

export const clearAuthCookie = (res) => {
  res.clearCookie(AUTH_COOKIE, baseOptions());
};
