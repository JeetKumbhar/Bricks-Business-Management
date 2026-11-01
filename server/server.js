import app from "./app.js";
import { env } from "./config/env.js";

const server = app.listen(env.port, () => {
  console.log(`[server] ${env.nodeEnv} mode, listening on port ${server.address().port}`);
  console.log(`[server] allowed browser origin(s): ${env.clientOrigins.join(", ")}`);
});

server.on("error", (err) => {
  console.error(`[server] could not start: ${err.code === "EADDRINUSE" ? `port ${env.port} is already in use` : err.message}`);
  process.exit(1);
});

// Graceful shutdown: stop accepting connections, let running requests finish, then exit.
// Database connections will be closed here once MongoDB is added.
let shuttingDown = false;
const shutdown = (reason, exitCode = 0) => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[server] ${reason}: shutting down`);

  const forceExit = setTimeout(() => {
    console.error("[server] forced exit: open connections did not close in 10 seconds");
    process.exit(1);
  }, 10_000);
  forceExit.unref();

  server.close((err) => {
    if (err) console.error("[server] error while closing", err);
    process.exit(err ? 1 : exitCode);
  });
  server.closeIdleConnections?.();
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
