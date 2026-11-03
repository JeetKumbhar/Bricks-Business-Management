import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import { env } from "./config/env.js";
import requireAuth from "./middlewares/auth.middleware.js";
import errorHandler from "./middlewares/error.middleware.js";
import notFound from "./middlewares/notFound.middleware.js";
import originCheck from "./middlewares/originCheck.middleware.js";
import { createLoginLimiter } from "./middlewares/rateLimit.middleware.js";
import { createAuthRouter } from "./routes/auth.routes.js";
import healthRoutes from "./routes/health.routes.js";
import attendanceRoutes, { labourAttendanceRouter } from "./routes/attendance.routes.js";
import labourRoutes from "./routes/labour.routes.js";

// Built as a function so tests can create a fresh app. Nothing here listens on a port (see server.js).
// options.loginRateLimit lets tests use a small limit; production uses the defaults.
export function createApp({ loginRateLimit } = {}) {
  const app = express();

  // Behind a reverse proxy (Render, Railway, nginx...) set TRUST_PROXY so the rate limiter sees real client addresses.
  app.set("trust proxy", env.trustProxy);

  app.disable("x-powered-by");
  app.use(helmet());

  // Browsers on a configured origin are allowed. Requests with no Origin header (curl, health probes, server to server)
  // are not browser cross-origin requests, so they pass. A browser on any other origin gets no CORS headers and is blocked.
  app.use(
    cors({
      origin: (origin, callback) => callback(null, !origin || env.clientOrigins.includes(origin)),
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization"],
      credentials: true,
      maxAge: 600,
    })
  );

  app.use(originCheck);
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());

  // ---- Public routes: only these. ----
  app.use("/api/health", healthRoutes);
  app.use("/api/auth", createAuthRouter({ loginLimiter: createLoginLimiter(loginRateLimit) }));

  // ---- Everything below this line requires a valid login. ----
  // Private by default: a business router mounted after this line (labour, attendance, payments...) cannot be reached
  // without signing in, even if its author forgets to add a check.
  app.use("/api", requireAuth);
  // Business routers are mounted here, one phase at a time.
  app.use("/api/labours/:id/attendance", labourAttendanceRouter); // before /api/labours so it is matched first
  app.use("/api/labours", labourRoutes);
  app.use("/api/attendance", attendanceRoutes);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}

export default createApp();
