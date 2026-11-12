import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { createDiagnostics, describeError, installProcessDiagnostics, redact } from "../utils/diagnostics.js";
import { diag, setDiagnostics } from "../utils/diagnosticsHub.js";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "diag-"));
const make = (extra = {}) => {
  const dir = tmp();
  const warn = vi.fn();
  const d = createDiagnostics({ dir, enabled: true, warn, now: () => new Date("2026-11-12T10:00:00.000Z"), pid: 42, ...extra });
  return { d, dir, warn, read: () => fs.readFileSync(d.file, "utf8") };
};

describe("diagnostic file", () => {
  it("appends timestamped lines and creates the logs folder", () => {
    const { d, read } = make({ dir: path.join(tmp(), "logs", "nested") });
    d.event("startup", "port 5000");
    d.event("db-connection", "connected");
    const lines = read().trim().split("\n");
    expect(lines[0]).toBe("2026-11-12T10:00:00.000Z pid=42 startup port 5000");
    expect(lines).toHaveLength(2);
  });

  it("writes the complete stack trace and the cause of an error", () => {
    const { d, read } = make();
    const error = new Error("boom", { cause: new Error("root cause") });
    d.error("uncaught-exception", error);
    const text = read();
    expect(text).toContain("Error: boom");
    expect(text).toContain("diagnostics.test.js"); // a stack frame
    expect(text).toContain("caused by: Error: root cause");
  });

  it("handles thrown values that are not Errors", () => {
    expect(describeError("just text")).toContain("just text");
    expect(describeError({ a: 1 })).toContain('{"a":1}');
  });

  it("is a no-op when disabled (the test default) and writes nothing", () => {
    const dir = tmp();
    const d = createDiagnostics({ dir, enabled: false });
    expect(d.event("x")).toBe(false);
    expect(fs.existsSync(path.join(dir, "server-diagnostics.log"))).toBe(false);
  });

  it("keeps one older file when the log grows too big", () => {
    const { d, dir } = make();
    fs.writeFileSync(d.file, "x".repeat(5 * 1024 * 1024 + 10));
    d.event("after-rotation");
    expect(fs.existsSync(path.join(dir, "server-diagnostics.log.1"))).toBe(true);
    expect(fs.readFileSync(d.file, "utf8")).toContain("after-rotation");
  });
});

describe("logging can never crash or hide the original error", () => {
  it("a failing file system returns false, warns once, and never throws", () => {
    const fsImpl = { mkdirSync: () => { throw new Error("disk full"); }, statSync: fs.statSync, renameSync: fs.renameSync, appendFileSync: fs.appendFileSync };
    const { d, warn } = make({ fsImpl });
    expect(() => d.event("a")).not.toThrow();
    expect(() => d.error("b", new Error("x"))).not.toThrow();
    expect(d.event("c")).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("the hub swallows a broken logger", () => {
    setDiagnostics({ event: () => { throw new Error("bad"); }, error: () => { throw new Error("bad"); } });
    expect(() => diag.event("x")).not.toThrow();
    expect(() => diag.error("x", new Error("y"))).not.toThrow();
    setDiagnostics({ event: () => false, error: () => false });
  });
});

describe("secrets are never written", () => {
  it("redacts connection strings, JWTs, cookies, Authorization headers and password fields", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcDEF123_-xyz";
    const text = redact(`mongodb+srv://user:Passw0rd@cluster0.x.mongodb.net/db?a=b ${jwt}\nAuthorization: Bearer abcdef123456789\nCookie: brickpro_token=SECRETCOOKIE; other=1\n{"password":"Hunter2!","token":"tok123456"} password=abc123 JWT=zz`);
    for (const secret of ["Passw0rd", "cluster0", jwt, "abcdef123456789", "SECRETCOOKIE", "Hunter2!", "tok123456", "abc123"]) expect(text).not.toContain(secret);
  });

  it("removes the exact configured secret values wherever they appear", () => {
    const { d, read } = make({ secrets: () => ["my-very-long-jwt-secret-value"] });
    d.error("x", new Error("failed with my-very-long-jwt-secret-value inside"));
    expect(read()).not.toContain("my-very-long-jwt-secret-value");
  });

  it("an error message containing a connection string is redacted in the file", () => {
    const { d, read } = make();
    d.error("db-connect-failed", new Error("bad auth for mongodb+srv://u:p4ss@h.mongodb.net/x"));
    expect(read()).not.toMatch(/p4ss|u:p4ss/);
  });
});

describe("process events: recorded, then the same safe shutdown", () => {
  const setup = () => {
    const proc = new EventEmitter();
    const events = [];
    const diagnostics = { event: (n, t) => events.push(["event", n, t]), error: (n, e) => events.push(["error", n, e?.message]) };
    const shutdown = vi.fn();
    const consoleError = vi.fn();
    installProcessDiagnostics({ proc, diagnostics, shutdown, consoleError });
    return { proc, events, shutdown, consoleError, diagnostics };
  };

  it("an unhandled rejection is logged with its stack, printed, and the server shuts down with exit code 1 (not swallowed)", () => {
    const { proc, events, shutdown, consoleError } = setup();
    proc.emit("unhandledRejection", new Error("rejected"));
    expect(events[0]).toEqual(["error", "unhandled-rejection", "rejected"]);
    expect(consoleError).toHaveBeenCalled();
    expect(shutdown).toHaveBeenCalledWith("unhandledRejection", 1);
  });

  it("an uncaught exception is logged and shuts down with exit code 1", () => {
    const { proc, events, shutdown } = setup();
    proc.emit("uncaughtException", new Error("thrown"));
    expect(events[0]).toEqual(["error", "uncaught-exception", "thrown"]);
    expect(shutdown).toHaveBeenCalledWith("uncaughtException", 1);
  });

  it("the shutdown still runs even if the logger itself throws", () => {
    const proc = new EventEmitter();
    const shutdown = vi.fn();
    installProcessDiagnostics({ proc, diagnostics: { event: () => { throw new Error("log broken"); }, error: () => { throw new Error("log broken"); } }, shutdown, consoleError: () => {} });
    expect(() => proc.emit("uncaughtException", new Error("real problem"))).not.toThrow();
    expect(shutdown).toHaveBeenCalledWith("uncaughtException", 1);
  });

  it.each(["SIGTERM", "SIGINT", "SIGHUP", "SIGBREAK"])("%s is recorded with its reason and starts the normal shutdown", (signal) => {
    const { proc, events, shutdown } = setup();
    proc.emit(signal);
    expect(events).toContainEqual(["event", "signal", signal]);
    expect(shutdown).toHaveBeenCalledWith(signal);
  });

  it("records the process exit code", () => {
    const { proc, events } = setup();
    proc.emit("exit", 1);
    expect(events).toContainEqual(["event", "process-exit", "code=1"]);
  });

  it("installing twice never duplicates handlers", () => {
    const proc = new EventEmitter();
    const diagnostics = { event: () => {}, error: () => {} };
    expect(installProcessDiagnostics({ proc, diagnostics, shutdown: vi.fn() })).toBe(true);
    expect(installProcessDiagnostics({ proc, diagnostics, shutdown: vi.fn() })).toBe(false);
    expect(proc.listenerCount("uncaughtException")).toBe(1);
    expect(proc.listenerCount("SIGTERM")).toBe(1);
  });
});

describe("a real child process", () => {
  it("an unhandled rejection is written to the file with its stack and the process exits with code 1", async () => {
    const { spawnSync } = await import("node:child_process");
    const dir = tmp();
    const module = new URL("../utils/diagnostics.js", import.meta.url).href;
    const code = `
      import { createDiagnostics, installProcessDiagnostics } from ${JSON.stringify(module)};
      const diagnostics = createDiagnostics({ dir: ${JSON.stringify(dir)}, enabled: true });
      installProcessDiagnostics({ diagnostics, shutdown: (reason, code) => { diagnostics.event("shutdown-start", "reason=" + reason); process.exit(code); }, consoleError: () => {} });
      diagnostics.event("startup", "child");
      Promise.reject(new Error("child rejection mongodb://u:topsecret@h.net/db"));
      setTimeout(() => {}, 2000);
    `;
    const run = spawnSync(process.execPath, ["--input-type=module", "-e", code], { encoding: "utf8" });
    expect(run.status).toBe(1);
    const log = fs.readFileSync(path.join(dir, "server-diagnostics.log"), "utf8");
    expect(log).toContain("startup child");
    expect(log).toContain("unhandled-rejection");
    expect(log).toContain("child rejection");
    expect(log).toContain("shutdown-start reason=unhandledRejection");
    expect(log).toContain("process-exit code=1");
    expect(log).not.toContain("topsecret");
  });
});
