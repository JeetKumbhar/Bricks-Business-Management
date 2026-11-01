import cors from "cors";
import express from "express";
import helmet from "helmet";
import { env } from "./config/env.js";
import errorHandler from "./middlewares/error.middleware.js";
import notFound from "./middlewares/notFound.middleware.js";
import healthRoutes from "./routes/health.routes.js";

// Built as a function so tests can create a fresh app. Nothing here listens on a port (see server.js).
export function createApp() {
  const app = express();

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

  app.use(express.json({ limit: "1mb" }));

  app.use("/api/health", healthRoutes);
  // Business routers (auth, labour, ...) are mounted here in their own phases.

  app.use(notFound);
  app.use(errorHandler);
  return app;
}

export default createApp();
