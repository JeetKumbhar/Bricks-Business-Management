// Loads and validates environment variables once. Import `env` instead of reading process.env elsewhere.
import dotenv from "dotenv";

dotenv.config({ quiet: true });

const NODE_ENVS = ["development", "test", "production"];
const SAME_SITE = ["lax", "strict", "none"];

const fail = (message) => {
  throw new Error(`Invalid environment: ${message}`);
};

const nodeEnv = process.env.NODE_ENV || "development";
if (!NODE_ENVS.includes(nodeEnv)) fail(`NODE_ENV must be one of ${NODE_ENVS.join(", ")} (got "${nodeEnv}")`);
const isTest = nodeEnv === "test";
const isProduction = nodeEnv === "production";

const port = Number(process.env.PORT || 5000);
if (!Number.isInteger(port) || port < 0 || port > 65535) fail(`PORT must be 0-65535 (got "${process.env.PORT}")`);

// One origin or a comma-separated list, e.g. "http://localhost:5173,https://app.example.com".
const clientOrigins = (process.env.CLIENT_ORIGIN || "http://localhost:5173")
  .split(",")
  .map((origin) => origin.trim().replace(/\/+$/, ""))
  .filter(Boolean);
if (clientOrigins.length === 0) fail("CLIENT_ORIGIN must not be empty");
if (isProduction && clientOrigins.includes("*")) fail('CLIENT_ORIGIN must not be "*" in production');

// ---- Authentication ----
// The secret signs the login token. It must be long and random; anyone who has it can forge a login.
// Tests may run without one (a fixed throw-away value is used); every other mode must set it.
const jwtSecret = process.env.JWT_SECRET || (isTest ? "test-only-secret-not-for-real-use-0123456789" : "");
if (!jwtSecret) fail("JWT_SECRET is not set (generate one: node -e \"console.log(require('crypto').randomBytes(48).toString('base64url'))\")");
if (jwtSecret.length < 32) fail("JWT_SECRET must be at least 32 characters");

const jwtExpiresIn = process.env.JWT_EXPIRES_IN || "12h";
if (!/^\d+[smhd]$/.test(jwtExpiresIn)) fail(`JWT_EXPIRES_IN must look like 30m, 12h or 7d (got "${jwtExpiresIn}")`);

// Cookie SameSite. "lax" suits a frontend and API on the same site. Use "none" (needs HTTPS) when the frontend is on a
// different site, e.g. app on *.vercel.app and API on another domain. See docs/AUTH_AND_SECURITY.md.
const cookieSameSite = (process.env.COOKIE_SAME_SITE || "lax").toLowerCase();
if (!SAME_SITE.includes(cookieSameSite)) fail(`COOKIE_SAME_SITE must be one of ${SAME_SITE.join(", ")} (got "${process.env.COOKIE_SAME_SITE}")`);

// Cost of bcrypt hashing. Higher is slower for attackers and for you. 12 is a sound default.
const bcryptRounds = Number(process.env.BCRYPT_ROUNDS || 12);
if (!Number.isInteger(bcryptRounds) || bcryptRounds < (isTest ? 4 : 10) || bcryptRounds > 15) {
  fail(`BCRYPT_ROUNDS must be a whole number from ${isTest ? 4 : 10} to 15 (got "${process.env.BCRYPT_ROUNDS}")`);
}

// How many reverse proxies sit in front of the server (0 = none). Needed so rate limits see the real client IP.
const trustProxy = Number(process.env.TRUST_PROXY || 0);
if (!Number.isInteger(trustProxy) || trustProxy < 0 || trustProxy > 5) fail(`TRUST_PROXY must be a whole number from 0 to 5 (got "${process.env.TRUST_PROXY}")`);

export const env = Object.freeze({
  nodeEnv,
  isProduction,
  isTest,
  port,
  clientOrigins,
  mongodbUri: process.env.MONGODB_URI || "",
  jwtSecret,
  jwtExpiresIn,
  cookieSameSite,
  // Browsers only accept SameSite=None cookies over HTTPS, and production must always be HTTPS.
  cookieSecure: isProduction || cookieSameSite === "none",
  bcryptRounds,
  trustProxy,
});
