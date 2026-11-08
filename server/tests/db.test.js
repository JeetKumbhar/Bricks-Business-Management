import mongoose from "mongoose";
import { afterEach, describe, expect, it, vi } from "vitest";

process.env.NODE_ENV = "test";

const { connectDB, describeTarget, disconnectDB, explainConnectionError, getDbStatus, redactUri } = await import("../config/db.js");

// Temporary own-property overrides on the connection object (its readyState / db / name are prototype getters).
const overridden = [];
const override = (name, value) => {
  Object.defineProperty(mongoose.connection, name, { value, configurable: true, writable: true });
  overridden.push(name);
};
afterEach(() => {
  vi.restoreAllMocks();
  while (overridden.length) delete mongoose.connection[overridden.pop()];
});

describe("redactUri / describeTarget", () => {
  it("hides credentials but keeps host and database", () => {
    const uri = "mongodb+srv://owner:s3cr%40t@cluster0.ab1cd.mongodb.net/brickpro?retryWrites=true&w=majority";
    expect(redactUri(uri)).toBe("mongodb+srv://***:***@cluster0.ab1cd.mongodb.net/brickpro?retryWrites=true&w=majority");
    expect(redactUri(uri)).not.toContain("s3cr");
    expect(describeTarget(uri)).toBe("cluster0.ab1cd.mongodb.net/brickpro");
    expect(describeTarget("mongodb://127.0.0.1:27017/brickpro")).toBe("127.0.0.1:27017/brickpro");
    expect(describeTarget("mongodb://127.0.0.1:27017")).toBe("127.0.0.1:27017");
    expect(describeTarget("nonsense")).toBe("(unreadable connection string)");
  });
});

describe("explainConnectionError", () => {
  const msg = (err) => explainConnectionError(err).message;

  it("explains bad credentials", () => {
    const err = Object.assign(new Error("bad auth : Authentication failed."), { name: "MongoServerError", code: 18 });
    expect(msg(err)).toMatch(/username or password/);
  });
  it("explains an unknown host", () => {
    expect(msg(new Error("querySrv ENOTFOUND _mongodb._tcp.nope.mongodb.net"))).toMatch(/host could not be found/);
  });
  it("explains a refused connection", () => {
    expect(msg(new Error("connect ECONNREFUSED 127.0.0.1:27017"))).toMatch(/refused the connection/);
  });
  it("explains a timeout / blocked IP", () => {
    const err = Object.assign(new Error("Server selection timed out after 10000 ms"), { name: "MongoServerSelectionError" });
    expect(msg(err)).toMatch(/Network Access list/);
  });
  it("explains a malformed connection string", () => {
    const err = Object.assign(new Error('Invalid scheme, expected connection string to start with "mongodb://"'), { name: "MongoParseError" });
    expect(msg(err)).toMatch(/not a valid MongoDB connection string/);
  });
  it("keeps the original error as the cause and never echoes a password", () => {
    const original = new Error("connect ECONNREFUSED");
    const wrapped = explainConnectionError(original);
    expect(wrapped.cause).toBe(original);
    expect(wrapped.name).toBe("DatabaseConnectionError");
  });
});

describe("connectDB", () => {
  it("fails clearly when MONGODB_URI is missing", async () => {
    await expect(connectDB("")).rejects.toThrow(/MONGODB_URI is not set/);
  });

  it("wraps a driver failure in a readable error", async () => {
    vi.spyOn(mongoose, "connect").mockRejectedValue(Object.assign(new Error("bad auth : Authentication failed."), { code: 18 }));
    await expect(connectDB("mongodb://u:p@127.0.0.1:27017/x")).rejects.toThrow(/username or password/);
  });
});

describe("getDbStatus", () => {
  const withState = (readyState, db) => {
    override("readyState", readyState);
    if (db) override("db", db);
  };

  it("reports disconnected when nothing is connected", async () => {
    expect(await getDbStatus()).toEqual({ status: "disconnected" });
  });

  it("reports connecting and disconnecting states", async () => {
    withState(2);
    expect(await getDbStatus()).toEqual({ status: "connecting" });
    withState(3);
    expect(await getDbStatus()).toEqual({ status: "disconnecting" });
  });

  it("reports connected only when the server answers a ping", async () => {
    withState(1, { admin: () => ({ ping: async () => ({ ok: 1 }) }) });
    override("name", "brickpro");
    expect(await getDbStatus()).toEqual({ status: "connected", name: "brickpro" });
  });

  it("reports unreachable when the connection looks open but the ping fails", async () => {
    withState(1, { admin: () => ({ ping: async () => { throw new Error("socket closed"); } }) });
    expect(await getDbStatus()).toEqual({ status: "unreachable" });
  });
});

describe("disconnect warning", () => {
  const connected = async () => {
    vi.spyOn(mongoose, "connect").mockResolvedValue(mongoose);
    await connectDB("mongodb://u:p@127.0.0.1:27017/x");
    mongoose.connection.emit("connected");
  };

  it("still warns when the connection is lost unexpectedly", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await connected();
    mongoose.connection.emit("disconnected");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("lost the connection to MongoDB"));
  });

  it("does not warn when disconnectDB closes the connection on purpose, and warns again after a later reconnect and drop", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await connected();
    override("readyState", 1);
    const close = vi.spyOn(mongoose, "disconnect").mockImplementation(async () => {
      mongoose.connection.emit("disconnected");
    });
    await disconnectDB();
    expect(close).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();
    mongoose.connection.emit("connected"); // connected again later
    mongoose.connection.emit("disconnected"); // then dropped unexpectedly
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("keeps warning if the deliberate close itself fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await connected();
    override("readyState", 1);
    vi.spyOn(mongoose, "disconnect").mockRejectedValue(new Error("close failed"));
    await expect(disconnectDB()).rejects.toThrow("close failed");
    mongoose.connection.emit("disconnected");
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("does nothing when there is no connection to close", async () => {
    const close = vi.spyOn(mongoose, "disconnect");
    await disconnectDB();
    expect(close).not.toHaveBeenCalled();
  });
});
