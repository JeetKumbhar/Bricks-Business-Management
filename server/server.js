import app from "./app.js";
import { connectDB, describeTarget, disconnectDB } from "./config/db.js";
import { env } from "./config/env.js";
import { createDiagnostics, installProcessDiagnostics } from "./utils/diagnostics.js";
import { setDiagnostics } from "./utils/diagnosticsHub.js";

// Persistent diagnostics (server/logs/server-diagnostics.log). Secrets are removed from everything written.
const diagnostics = createDiagnostics({ secrets: () => [env.jwtSecret, env.mongodbUri, process.env.OWNER_PASSWORD] });
setDiagnostics(diagnostics);
diagnostics.event("startup", `${env.nodeEnv} node=${process.version} platform=${process.platform} port=${env.port} cwd=${process.cwd()}`);

let server;
let shuttingDown = false;

// Graceful shutdown: stop accepting connections, let running requests finish, close the database, then exit.
const shutdown = async (reason, exitCode = 0) => {
  if (shuttingDown) {
    diagnostics.event("shutdown-already-running", `${reason} (ignored, a shutdown is already in progress)`);
    return;
  }
  shuttingDown = true;
  console.log(`[server] ${reason}: shutting down`);
  diagnostics.event("shutdown-start", `reason=${reason} exitCode=${exitCode}`);

  const forceExit = setTimeout(() => {
    console.error("[server] forced exit: open connections did not close in 10 seconds");
    diagnostics.event("forced-exit", "open connections did not close in 10 seconds");
    process.exit(1);
  }, 10_000);
  forceExit.unref();

  let code = exitCode;
  if (server?.listening) {
    await new Promise((resolve) => {
      server.close((err) => {
        if (err) {
          console.error("[server] error while closing", err);
          diagnostics.error("server-close-error", err);
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
    diagnostics.error("db-close-error", err);
    code = 1;
  }
  diagnostics.event("shutdown-complete", `exiting with code ${code}`);
  process.exit(code);
};

installProcessDiagnostics({ diagnostics, shutdown }); // fatal errors and signals: logged with full stack, then the same safe shutdown

// 1. Database first: if it cannot be reached, stop with a clear message instead of serving errors.
try {
  console.log(`[db] connecting to ${describeTarget(env.mongodbUri)} ...`);
  await connectDB();
  console.log("[db] connected");
  diagnostics.event("db-connected");
} catch (err) {
  console.error(`[db] ${err.message}`);
  diagnostics.error("db-connect-failed", err);
  process.exit(1);
}

// 2. Then accept traffic.
server = app.listen(env.port, () => {
  console.log(`[server] ${env.nodeEnv} mode, listening on port ${server.address().port}`);
  diagnostics.event("listening", `port ${server.address().port}`);
  console.log(`[server] allowed browser origin(s): ${env.clientOrigins.join(", ")}`);
});

server.on("error", async (err) => {
  diagnostics.error("server-error", err);
  console.error(`[server] could not start: ${err.code === "EADDRINUSE" ? `port ${env.port} is already in use` : err.message}`);
  await disconnectDB().catch(() => {});
  process.exit(1);
});
