import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Persistent crash diagnostics. Every important process event is appended, with a timestamp, to server/logs/server-diagnostics.log
// (the logs/ folder is ignored by Git). This file survives a closed terminal window, which the console does not.
//
// Rules:
//  - Logging can NEVER throw or change what the process does: every file operation is wrapped, and a failure only prints one console warning.
//  - Secrets are removed before anything is written (connection strings, tokens, cookies, Authorization, passwords, and the exact values of
//    the configured secrets). Request bodies, headers and query strings are never logged: only method + path.
//  - It observes and records fatal errors; it never suppresses them. The caller still shuts the process down.
//  - Writes are synchronous on purpose: during a crash or at "exit" an asynchronous write would be lost.
//  - Disabled while the test suite runs (NODE_ENV=test) unless a directory is passed explicitly.

const MAX_BYTES = 5 * 1024 * 1024; // one older file is kept as server-diagnostics.log.1

export const redact = (text, secretValues = []) => {
  let out = String(text ?? "");
  for (const secret of secretValues) if (typeof secret === "string" && secret.length >= 6) out = out.split(secret).join("***");
  return out
    .replace(/mongodb(?:\+srv)?:\/\/[^\s"'`)]+/gi, "mongodb://***")
    .replace(/eyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{4,}/g, "***jwt***")
    .replace(/\b(authorization|proxy-authorization)\b\s*[:=]\s*[^\r\n]+/gi, "$1: ***")
    .replace(/\b(set-cookie|cookie)\b\s*[:=]\s*[^\r\n]+/gi, "$1: ***")
    .replace(/\bbearer\s+[\w.~+/=-]{8,}/gi, "Bearer ***")
    .replace(/\b(brickpro_token|token|access_token|refresh_token|secret|password|passwd|pwd|api[_-]?key)\b(["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;&}"']+)/gi, "$1$2***");
};

/** Message + full stack + code + cause of any thrown value, as plain text. */
export const describeError = (error) => {
  if (error instanceof Error) {
    const parts = [`${error.name}: ${error.message}`];
    if (error.code !== undefined) parts.push(`code: ${error.code}`);
    if (error.stack) parts.push(error.stack);
    if (error.cause instanceof Error) parts.push(`caused by: ${error.cause.name}: ${error.cause.message}`, error.cause.stack ?? "");
    return parts.join("\n");
  }
  try {
    return `non-Error value thrown: ${typeof error === "string" ? error : JSON.stringify(error)}`;
  } catch {
    return `non-Error value thrown: ${String(error)}`;
  }
};

export const createDiagnostics = ({
  dir = fileURLToPath(new URL("../logs/", import.meta.url)),
  fileName = "server-diagnostics.log",
  enabled = process.env.NODE_ENV !== "test",
  secrets = () => [],
  now = () => new Date(),
  fsImpl = fs,
  warn = (message) => console.warn(message),
  pid = process.pid,
} = {}) => {
  const file = path.join(dir, fileName);
  let warned = false;
  const warnOnce = (error) => {
    if (warned) return;
    warned = true;
    try {
      warn(`[diagnostics] cannot write ${file}: ${error?.message}. Continuing without the log file.`);
    } catch {
      /* nothing left to do */
    }
  };

  const write = (event, text = "") => {
    if (!enabled) return false;
    try {
      const body = redact(text, secrets()).replace(/\r?\n/g, "\n    ");
      const line = `${now().toISOString()} pid=${pid} ${event}${body ? ` ${body}` : ""}\n`;
      fsImpl.mkdirSync(dir, { recursive: true });
      try {
        if (fsImpl.statSync(file).size > MAX_BYTES) fsImpl.renameSync(file, `${file}.1`);
      } catch {
        /* no file yet, or rotation not possible: keep appending */
      }
      fsImpl.appendFileSync(file, line);
      return true;
    } catch (error) {
      warnOnce(error);
      return false;
    }
  };

  return {
    file,
    /** An ordinary event line: "startup", "shutdown-requested", "db-connected", ... */
    event: (name, text) => write(name, typeof text === "string" ? text : text === undefined ? "" : JSON.stringify(text)),
    /** An error with its full stack. */
    error: (name, error, context) => write(name, `${context ? `${typeof context === "string" ? context : JSON.stringify(context)}\n` : ""}${describeError(error)}`),
  };
};

/**
 * Hooks the process-level events ONCE (a second call does nothing, so handlers never duplicate). Order for a fatal error:
 * write the full stack to the file and the console first, then call the existing safe `shutdown(reason, 1)`. Nothing is swallowed.
 */
export const installProcessDiagnostics = ({ proc = process, diagnostics, shutdown, consoleError = (...a) => console.error(...a) }) => {
  if (proc.__brickproDiagnosticsInstalled) return false;
  proc.__brickproDiagnosticsInstalled = true;

  const fatal = (name, error) => {
    try {
      diagnostics.error(name, error);
      consoleError(`[server] ${name === "unhandled-rejection" ? "unhandled rejection" : "uncaught exception"}`, error);
    } catch {
      /* never hide the original error behind a logging problem */
    }
    shutdown(name === "unhandled-rejection" ? "unhandledRejection" : "uncaughtException", 1);
  };
  proc.on("unhandledRejection", (reason) => fatal("unhandled-rejection", reason));
  proc.on("uncaughtException", (error) => fatal("uncaught-exception", error));

  // SIGHUP / SIGBREAK are what closing the terminal window sends (Linux/macOS and Windows).
  for (const signal of ["SIGTERM", "SIGINT", "SIGHUP", "SIGBREAK"]) {
    try {
      proc.on(signal, () => {
        diagnostics.event("signal", signal);
        shutdown(signal);
      });
    } catch {
      /* this signal does not exist on this platform */
    }
  }
  proc.on("warning", (warning) => diagnostics.event("process-warning", `${warning?.name}: ${warning?.message}`));
  proc.on("exit", (code) => diagnostics.event("process-exit", `code=${code}`));
  return true;
};
