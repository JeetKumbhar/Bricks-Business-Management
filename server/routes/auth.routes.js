import { Router } from "express";
import { login, logout, me } from "../controllers/auth.controller.js";
import requireAuth from "../middlewares/auth.middleware.js";
import { createLoginLimiter } from "../middlewares/rateLimit.middleware.js";
import validate from "../middlewares/validation.middleware.js";
import asyncHandler from "../utils/asyncHandler.js";
import { loginSchema } from "../validators/auth.validators.js";

// /api/auth. login and logout are public; me needs a valid login.
export function createAuthRouter({ loginLimiter = createLoginLimiter() } = {}) {
  const router = Router();

  // Responses here are personal and must never be stored by a browser or proxy cache.
  router.use((_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });

  router.post("/login", loginLimiter, validate(loginSchema), asyncHandler(login));
  router.post("/logout", logout);
  router.get("/me", requireAuth, me);

  return router;
}

export default createAuthRouter;
