import { rateLimit } from "express-rate-limit";
import { errorBody } from "../utils/apiResponse.js";

export const LOGIN_WINDOW_MS = 15 * 60 * 1000;
export const LOGIN_MAX_FAILURES = 10;

/**
 * Slows password guessing: at most 10 FAILED logins per IP address in 15 minutes, then 429 until the window passes.
 * Successful logins are not counted, so the owner is not locked out by their own normal use.
 * The count is kept in memory (fine for one server process; use a shared store if the API is ever scaled to several).
 * Deliberately per IP and not per account: a per-account lock would let a stranger lock the owner out by guessing.
 */
export const createLoginLimiter = ({ windowMs = LOGIN_WINDOW_MS, limit = LOGIN_MAX_FAILURES } = {}) =>
  rateLimit({
    windowMs,
    limit,
    skipSuccessfulRequests: true,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    handler: (_req, res) => {
      res.status(429).json(errorBody("Too many login attempts. Please try again later."));
    },
  });
