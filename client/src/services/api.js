// Central API client. Every request to the Express backend goes through this file; no component calls fetch() itself.
//
// Same-origin by design: the browser always calls a relative "/api/..." path. In development Vite proxies it to the local
// server (vite.config.js); in production the Vercel rewrite forwards it to the deployed backend (vercel.json). The login
// cookie is therefore a first-party cookie, and no backend address or secret is ever compiled into the frontend.
//
// Backend contract (server/utils/apiResponse.js, server/middlewares/error.middleware.js):
//   success: { success: true,  message, data, meta? }
//   failure: { success: false, message, errors?: [{ field, message }] }
// Successful calls resolve with that whole envelope, so callers can read `data` and `meta`.
// Failed calls reject with an ApiError. Nothing here ever falls back to sample data.

const DEFAULT_BASE = "/api";
const DEFAULT_TIMEOUT_MS = 20000;

const readBase = () => {
  const fromEnv = typeof import.meta !== "undefined" ? import.meta.env?.VITE_API_BASE_URL : undefined;
  return String(fromEnv || DEFAULT_BASE).replace(/\/+$/, "");
};

export const API_ERROR_CODES = Object.freeze({
  NETWORK: "NETWORK", // the request never reached the server
  TIMEOUT: "TIMEOUT", // the server did not answer in time
  BAD_RESPONSE: "BAD_RESPONSE", // an answer arrived, but it is not the API's JSON (for example a proxy error page)
  HTTP: "HTTP", // the API answered with an error status
});

export class ApiError extends Error {
  constructor(message, { status = 0, code = API_ERROR_CODES.HTTP, errors = [] } = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.errors = errors;
  }

  /** True when the server was not reached or did not answer properly (as opposed to refusing the request). */
  get isConnectionProblem() {
    return this.code === API_ERROR_CODES.NETWORK || this.code === API_ERROR_CODES.TIMEOUT || this.code === API_ERROR_CODES.BAD_RESPONSE || this.status >= 500;
  }
}

/** A message that is safe to show to the owner. */
export const getErrorMessage = (error, fallback = "Something went wrong. Please try again.") =>
  error instanceof ApiError && error.message ? error.message : fallback;

/** { field: message } from a 400 "Validation failed" response (first message per field wins). */
export const getFieldErrors = (error) => {
  const out = {};
  if (error instanceof ApiError) {
    for (const item of error.errors) if (item?.field && !(item.field in out)) out[item.field] = item.message;
  }
  return out;
};

// ---- Session-expired handling -------------------------------------------------------------------------------------
// When a request that needs a login comes back 401, the session is gone. AuthContext registers one handler here; it
// clears the signed-in user so the protected routes send the owner to the login page. Calls made by the sign-in /
// sign-out flow itself pass `skipUnauthorizedHandler` (a wrong password is also a 401 and must not look like an expiry).
let unauthorizedHandler = null;
export const setUnauthorizedHandler = (handler) => {
  unauthorizedHandler = typeof handler === "function" ? handler : null;
  return () => {
    if (unauthorizedHandler === handler) unauthorizedHandler = null;
  };
};

const buildUrl = (path, query) => {
  const clean = `/${String(path).replace(/^\/+/, "")}`;
  const params = new URLSearchParams();
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === "") continue;
      params.append(key, String(value));
    }
  }
  const qs = params.toString();
  return `${readBase()}${clean}${qs ? `?${qs}` : ""}`;
};

const parseJson = async (response) => {
  const type = response.headers.get("content-type") || "";
  if (!type.includes("application/json")) return undefined;
  try {
    return await response.json();
  } catch {
    return undefined;
  }
};

/**
 * request(method, path, { body, query, signal, timeoutMs, skipUnauthorizedHandler })
 * `path` is relative to the API base, e.g. "/labours". `body` is sent as JSON.
 */
export async function request(method, path, { body, query, signal, timeoutMs = DEFAULT_TIMEOUT_MS, skipUnauthorizedHandler = false } = {}) {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const onCallerAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener("abort", onCallerAbort, { once: true });
  }

  let response;
  try {
    response = await fetch(buildUrl(path, query), {
      method,
      credentials: "include", // sends the httpOnly login cookie
      signal: controller.signal,
      headers: { Accept: "application/json", ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    if (signal?.aborted && !timedOut) throw err; // the caller cancelled on purpose (for example a screen closed); not an error to show
    if (timedOut) throw new ApiError("The server is taking too long to respond. Please try again.", { code: API_ERROR_CODES.TIMEOUT });
    throw new ApiError("Cannot reach the server. Check your internet connection and try again.", { code: API_ERROR_CODES.NETWORK });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onCallerAbort);
  }

  const payload = await parseJson(response);

  if (!response.ok) {
    if (payload && typeof payload === "object" && "message" in payload) {
      if (response.status === 401 && !skipUnauthorizedHandler) unauthorizedHandler?.();
      throw new ApiError(String(payload.message), { status: response.status, code: API_ERROR_CODES.HTTP, errors: Array.isArray(payload.errors) ? payload.errors : [] });
    }
    // An error page from a proxy or host, not from the API.
    throw new ApiError("The server returned an unexpected response. Please try again in a moment.", { status: response.status, code: API_ERROR_CODES.BAD_RESPONSE });
  }

  if (!payload || typeof payload !== "object" || payload.success !== true) {
    // 200 with something that is not the API envelope, e.g. the SPA's index.html served because /api is not proxied.
    throw new ApiError("The server returned an unexpected response. Please try again in a moment.", { status: response.status, code: API_ERROR_CODES.BAD_RESPONSE });
  }
  return payload;
}

export const api = {
  get: (path, options) => request("GET", path, options),
  post: (path, body, options) => request("POST", path, { ...options, body }),
  put: (path, body, options) => request("PUT", path, { ...options, body }),
  patch: (path, body, options) => request("PATCH", path, { ...options, body }),
  delete: (path, body, options) => request("DELETE", path, { ...options, body }),
};

export default api;
