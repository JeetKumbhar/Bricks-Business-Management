// MongoDB connection (Mongoose). The server connects BEFORE it accepts traffic (see server.js).
// Conventions: docs/DATABASE_CONVENTIONS.md
import mongoose from "mongoose";
import { env } from "./env.js";

// Reject queries with unknown filter fields instead of silently ignoring them.
mongoose.set("strictQuery", true);
// Index builds are explicit in production (an automatic build on a large collection can stall start-up).
mongoose.set("autoIndex", !env.isProduction);

const READY_STATES = { 0: "disconnected", 1: "connected", 2: "connecting", 3: "disconnecting" };

/** Hides the password (and user) so a connection string is safe to log. */
export const redactUri = (uri = "") => uri.replace(/\/\/[^@/]*@/, "//***:***@");

/** Host and database name only, for logs. Never throws. */
export const describeTarget = (uri = "") => {
  const match = uri.match(/^mongodb(?:\+srv)?:\/\/(?:[^@/]*@)?([^/?]+)(?:\/([^?]*))?/);
  if (!match) return "(unreadable connection string)";
  return match[2] ? `${match[1]}/${match[2]}` : match[1];
};

/**
 * Turns a driver error into a message a person can act on. The original error is kept as `cause`.
 */
export const explainConnectionError = (err) => {
  const text = `${err?.name ?? ""} ${err?.codeName ?? ""} ${err?.message ?? ""} ${err?.cause?.message ?? ""}`;
  let message;

  if (err?.code === 18 || /authentication failed|bad auth|AuthenticationFailed/i.test(text)) {
    message = "MongoDB rejected the username or password. Check the credentials in MONGODB_URI (URL-encode special characters in the password).";
  } else if (/ENOTFOUND|EAI_AGAIN|querySrv/i.test(text)) {
    message = "MongoDB host could not be found. Check the cluster address in MONGODB_URI and your internet connection.";
  } else if (/ECONNREFUSED/i.test(text)) {
    message = "MongoDB refused the connection. For a local database, check that mongod is running and the port is right.";
  } else if (/MongoParseError|Invalid scheme|Invalid connection string|option .* not supported|URI malformed/i.test(text)) {
    message = "MONGODB_URI is not a valid MongoDB connection string (it must start with mongodb:// or mongodb+srv://).";
  } else if (/ServerSelection|timed out|ETIMEDOUT|ENETUNREACH|not reachable/i.test(text)) {
    message =
      "MongoDB could not be reached within 10 seconds. On Atlas, check that this machine's IP is on the Network Access list and the cluster is not paused.";
  } else if (/ssl|tls|certificate/i.test(text)) {
    message = "A secure (TLS) connection to MongoDB could not be established. Check the connection string and the network.";
  } else {
    message = `Could not connect to MongoDB: ${err?.message ?? "unknown error"}`;
  }

  const error = new Error(message, { cause: err });
  error.name = "DatabaseConnectionError";
  return error;
};

let listenersAttached = false;
let everConnected = false;
let closingOnPurpose = false; // set by disconnectDB so a deliberate shutdown is not reported as a lost connection
const attachListeners = () => {
  if (listenersAttached) return;
  listenersAttached = true;
  const { connection } = mongoose;
  // After a successful start the driver reconnects by itself when the link drops; these lines make that visible.
  // Before the first success a failure is reported once, by connectDB, so these stay quiet then.
  connection.on("connected", () => {
    everConnected = true;
    closingOnPurpose = false;
  });
  connection.on("disconnected", () => {
    if (everConnected && !closingOnPurpose) console.warn("[db] lost the connection to MongoDB (the driver will keep trying to reconnect)");
  });
  connection.on("reconnected", () => console.log("[db] reconnected to MongoDB"));
  connection.on("error", (err) => {
    if (everConnected) console.error("[db] connection error:", err.message);
  });
};

/**
 * Connects once and resolves when the database is ready. Throws a DatabaseConnectionError on failure.
 * Calling it again while connected does nothing.
 */
export async function connectDB(uri = env.mongodbUri) {
  if (!uri) {
    const error = new Error("MONGODB_URI is not set. Copy server/.env.example to server/.env and add your connection string.");
    error.name = "DatabaseConnectionError";
    throw error;
  }
  if (mongoose.connection.readyState === 1) return mongoose.connection;

  attachListeners();
  try {
    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 10_000, // fail fast instead of hanging when the database is unreachable
      connectTimeoutMS: 10_000,
      socketTimeoutMS: 45_000,
      maxPoolSize: 10,
      retryWrites: true,
    });
  } catch (err) {
    await mongoose.disconnect().catch(() => {});
    throw explainConnectionError(err);
  }
  return mongoose.connection;
}

export async function disconnectDB() {
  if (mongoose.connection.readyState === 0) return;
  closingOnPurpose = true; // cleared again on the next "connected" event, so a later unexpected drop still warns
  try {
    await mongoose.disconnect();
  } catch (err) {
    closingOnPurpose = false; // the close failed: do not hide what happens next
    throw err;
  }
}

/** Current state for the health check. `ping` asks the server, so a half-open connection is not reported as healthy. */
export async function getDbStatus({ ping = true } = {}) {
  const state = READY_STATES[mongoose.connection.readyState] ?? "unknown";
  if (state !== "connected") return { status: state };

  if (ping) {
    try {
      await Promise.race([
        mongoose.connection.db.admin().ping(),
        new Promise((_, reject) => setTimeout(() => reject(new Error("ping timed out")), 2_000).unref()),
      ]);
    } catch {
      return { status: "unreachable" };
    }
  }
  return { status: "connected", name: mongoose.connection.name };
}
