import app from "./app.js";
import { connectDB, describeTarget, disconnectDB } from "./config/db.js";
import { env } from "./config/env.js";

let server;
let shuttingDown = false;

// Graceful shutdown: stop accepting connections, let running requests finish, close the database, then exit.
const shutdown = async (reason, exitCode = 0) => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[server] ${reason}: shutting down`);

  const forceExit = setTimeout(() => {
    console.error("[server] forced exit: open connections did not close in 10 seconds");
    process.exit(1);
  }, 10_000);
  forceExit.unref();

  let code = exitCode;
  if (server?.listening) {
    await new Promise((resolve) => {
      server.close((err) => {
        if (err) {
          console.error("[server] error while closing", err);
          code = 1;
        }
        resolve();
      });
      server.closeIdleConnections?.();
    });
  }
  try {
    await disconnectDB();
  } catch (err) {
    console.error("[db] error while closing", err);
    code = 1;
  }
  process.exit(code);
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("unhandledRejection", (reason) => {
  console.error("[server] unhandled rejection", reason);
  shutdown("unhandledRejection", 1);
});
process.on("uncaughtException", (err) => {
  console.error("[server] uncaught exception", err);
  shutdown("uncaughtException", 1);
});

// 1. Database first: if it cannot be reached, stop with a clear message instead of serving errors.
try {
  console.log(`[db] connecting to ${describeTarget(env.mongodbUri)} ...`);
  await connectDB();
  console.log("[db] connected");
} catch (err) {
  console.error(`[db] ${err.message}`);
  process.exit(1);
}

// 2. Then accept traffic.
server = app.listen(env.port, () => {
  console.log(`[server] ${env.nodeEnv} mode, listening on port ${server.address().port}`);
  console.log(`[server] allowed browser origin(s): ${env.clientOrigins.join(", ")}`);
});

server.on("error", async (err) => {
  console.error(`[server] could not start: ${err.code === "EADDRINUSE" ? `port ${env.port} is already in use` : err.message}`);
  await disconnectDB().catch(() => {});
  process.exit(1);
});
