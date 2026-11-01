// Loads and validates environment variables once. Import `env` instead of reading process.env elsewhere.
// MONGODB_URI and JWT_* are read here so they have one home, but nothing uses them until the database and auth phases.
import dotenv from "dotenv";

dotenv.config({ quiet: true });

const NODE_ENVS = ["development", "test", "production"];

const fail = (message) => {
  throw new Error(`Invalid environment: ${message}`);
};

const nodeEnv = process.env.NODE_ENV || "development";
if (!NODE_ENVS.includes(nodeEnv)) fail(`NODE_ENV must be one of ${NODE_ENVS.join(", ")} (got "${nodeEnv}")`);

const port = Number(process.env.PORT || 5000);
if (!Number.isInteger(port) || port < 0 || port > 65535) fail(`PORT must be 0-65535 (got "${process.env.PORT}")`);

// One origin or a comma-separated list, e.g. "http://localhost:5173,https://app.example.com".
const clientOrigins = (process.env.CLIENT_ORIGIN || "http://localhost:5173")
  .split(",")
  .map((origin) => origin.trim().replace(/\/+$/, ""))
  .filter(Boolean);
if (clientOrigins.length === 0) fail("CLIENT_ORIGIN must not be empty");
if (nodeEnv === "production" && clientOrigins.includes("*")) fail('CLIENT_ORIGIN must not be "*" in production');

export const env = Object.freeze({
  nodeEnv,
  isProduction: nodeEnv === "production",
  isTest: nodeEnv === "test",
  port,
  clientOrigins,
  // Not used yet (database / auth phases).
  mongodbUri: process.env.MONGODB_URI || "",
  jwtSecret: process.env.JWT_SECRET || "",
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || "",
});
