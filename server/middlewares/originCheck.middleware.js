import { env } from "../config/env.js";
import ApiError from "../utils/ApiError.js";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

// Cross-site request forgery guard. The login cookie is sent automatically by the browser, so a malicious page could try to
// make the owner's browser send a request. Browsers always attach an Origin header to such requests, so a change-making
// request from any origin other than the configured frontend is refused. Requests with no Origin (curl, server-to-server)
// are not browser requests and are not affected.
export default function originCheck(req, _res, next) {
  if (SAFE_METHODS.has(req.method)) return next();
  const { origin } = req.headers;
  if (origin && !env.clientOrigins.includes(origin)) return next(ApiError.forbidden("Origin not allowed"));
  return next();
}
