import { beforeEach, describe, expect, it, vi } from "vitest";

// utils/transaction.js against a fake MongoDB session (no database): normal run, "transactions not supported", and strict mode.
const startSession = vi.fn();
vi.mock("mongoose", () => ({ default: { startSession: (...a) => startSession(...a) } }));
const { runInTransaction } = await import("../utils/transaction.js");

const unsupported = () => Object.assign(new Error("Transaction numbers are only allowed on a replica set member or mongos"), { code: 20 });
const sessionWith = (withTransaction) => ({ withTransaction, endSession: vi.fn() });

beforeEach(() => startSession.mockReset());

describe("runInTransaction", () => {
  it("returns the result of the work and ends the session", async () => {
    const session = sessionWith(async (fn) => fn());
    startSession.mockResolvedValue(session);
    expect(await runInTransaction(async () => "done")).toBe("done");
    expect(session.endSession).toHaveBeenCalled();
  });

  it("passes other database errors through unchanged, in both modes", async () => {
    startSession.mockResolvedValue(sessionWith(async () => { throw new Error("boom"); }));
    await expect(runInTransaction(async () => 1)).rejects.toThrow("boom");
    await expect(runInTransaction(async () => 1, { required: true })).rejects.toThrow("boom");
  });

  it("default mode: on a database without transactions the work still runs once, without a session (old behaviour)", async () => {
    startSession.mockResolvedValue(sessionWith(async () => { throw unsupported(); }));
    const work = vi.fn(async (session) => (session === null ? "plain" : "txn"));
    expect(await runInTransaction(work)).toBe("plain");
    expect(work).toHaveBeenCalledTimes(1);
  });

  it("required mode: on a database without transactions NOTHING runs and the caller gets a clear 503", async () => {
    startSession.mockResolvedValue(sessionWith(async () => { throw unsupported(); }));
    const work = vi.fn();
    const error = await runInTransaction(work, { required: true }).catch((e) => e);
    expect(error.statusCode).toBe(503);
    expect(error.message).toMatch(/Nothing was saved/);
    expect(work).not.toHaveBeenCalled();
  });
});
