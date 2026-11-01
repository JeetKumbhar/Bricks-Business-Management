import { Router } from "express";
import { env } from "../config/env.js";
import { sendSuccess } from "../utils/apiResponse.js";

const router = Router();

// GET /api/health. Liveness only; it does not check the database (not connected yet).
router.get("/", (_req, res) =>
  sendSuccess(res, {
    message: "Server is healthy",
    data: {
      status: "ok",
      environment: env.nodeEnv,
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    },
  })
);

export default router;
