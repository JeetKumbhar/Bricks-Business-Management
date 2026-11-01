import { Router } from "express";
import { getDbStatus } from "../config/db.js";
import { env } from "../config/env.js";
import asyncHandler from "../utils/asyncHandler.js";
import { sendSuccess } from "../utils/apiResponse.js";

const router = Router();

// GET /api/health. 200 only when the process is up AND the database answers a ping; otherwise 503,
// so a load balancer or uptime monitor sees a database outage as unhealthy.
router.get(
  "/",
  asyncHandler(async (_req, res) => {
    const database = await getDbStatus();
    const healthy = database.status === "connected";
    const data = {
      status: healthy ? "ok" : "degraded",
      environment: env.nodeEnv,
      database,
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    };

    if (healthy) return sendSuccess(res, { message: "Server is healthy", data });
    return res.status(503).json({ success: false, message: "Server is running but the database is not available", data });
  })
);

export default router;
