import { findUserForToken, toPublicUser, verifyAccessToken } from "../services/auth.service.js";
import ApiError from "../utils/ApiError.js";
import asyncHandler from "../utils/asyncHandler.js";
import { AUTH_COOKIE, clearAuthCookie } from "../utils/authCookie.js";

// Protects a route. Every failure gives the same 401, so the response does not say whether the token was missing,
// forged, expired, or belonged to a disabled account. On success `req.user` is { id, name, email, role }.
const requireAuth = asyncHandler(async (req, res, next) => {
  const token = req.cookies?.[AUTH_COOKIE];
  const payload = token ? verifyAccessToken(token) : null;
  const user = payload ? await findUserForToken(payload) : null;

  if (!user) {
    if (token) clearAuthCookie(res); // drop a dead cookie so the browser stops sending it
    throw ApiError.unauthorized();
  }

  req.user = toPublicUser(user);
  next();
});

export default requireAuth;
export { requireAuth };
