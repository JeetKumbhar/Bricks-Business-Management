// FAKE-DATABASE tests for scripts/createProductionOwner.js. No MongoDB, no network, no .env: the services are replaced by in-memory fakes,
// and the child-process tests stop at a guard (or at the missing terminal) before any module that could connect is even loaded.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { checkPasswordPolicy } from "../services/auth.service.js";
import { PRODUCTION_DB, guardProblem, hasUniqueEmailIndex, runCreateProductionOwner } from "../scripts/createProductionOwner.js";

const SCRIPT = fileURLToPath(new URL("../scripts/createProductionOwner.js", import.meta.url));
const PROD_URI = `mongodb+srv://someuser:SECRET-PW-123@cluster.example.net/${PRODUCTION_DB}?retryWrites=true`;
const GOOD_ARGV = ["--email", "Owner@Example.com", "--name", "Aayush Owner", "--confirm-db", PRODUCTION_DB];
const PASSWORD = "a-long-secret-pass-1";

/** A fake of the real services: users live in an array; every call is recorded. */
const GOOD_INDEXES = [{ key: { _id: 1 }, name: "_id_" }, { key: { email: 1 }, name: "email_1", unique: true }];
const makeFake = ({ users = [], connectError = null, indexes = GOOD_INDEXES, initError = null } = {}) => {
  const calls = [];
  const services = {
    connect: async () => {
      calls.push("connect");
      if (connectError) throw connectError;
    },
    disconnect: async () => void calls.push("disconnect"),
    initIndexes: async () => {
      calls.push("init");
      if (initError) throw initError;
      return indexes;
    },
    countUsers: async () => (calls.push("count"), users.length),
    createUser: async ({ name, email, password }) => {
      calls.push("create");
      if (users.some((u) => u.email === email)) throw Object.assign(new Error("An account with this email already exists"), { code: "EMAIL_TAKEN" });
      const user = { name, email, role: "OWNER", password };
      users.push(user);
      return { name, email, role: "OWNER" };
    },
    checkPasswordPolicy,
  };
  return { calls, users, services };
};

const run = async (opts = {}) => {
  const { argv = GOOD_ARGV, fake = makeFake(), password = PASSWORD, readPassword } = opts;
  const uri = "uri" in opts ? opts.uri : PROD_URI; // an explicit undefined means "not set"
  const out = [];
  const err = [];
  let loaded = 0;
  const code = await runCreateProductionOwner({
    argv,
    uri,
    readPassword: readPassword ?? (async () => password),
    loadServices: async () => (loaded++, fake.services),
    log: (m) => out.push(m),
    error: (m) => err.push(m),
  });
  return { code, out: out.join("\n"), err: err.join("\n"), fake, loaded };
};

describe("safety guards (nothing is loaded, asked or connected when one fails)", () => {
  const refused = (r, text) => {
    expect(r.code).toBe(1);
    expect(r.err).toContain(text);
    expect(r.loaded).toBe(0);
    expect(r.fake.calls).toEqual([]);
    expect(r.fake.users).toEqual([]);
  };

  it("refuses when MONGODB_URI is not set in the session", async () => refused(await run({ uri: undefined }), "not set in this terminal session"));
  it("refuses an unreadable connection string", async () => refused(await run({ uri: "not-a-uri" }), "not a readable"));
  it("refuses a URI with no database name", async () => refused(await run({ uri: "mongodb+srv://u:p@cluster.example.net/?x=1" }), "(none)"));
  it.each(["aayush_carting_test", "brickpro_dev", "aayush_carting_prod_test", "AAYUSH_CARTING_PROD", "aayush_carting_prod2", "aayush_carting"])("refuses the database %s", async (db) =>
    refused(await run({ uri: `mongodb://u:p@h.example.net/${db}` }), "not \"aayush_carting_prod\""));
  it("refuses without --confirm-db", async () => refused(await run({ argv: ["--email", "o@example.com", "--name", "Owner"] }), "--confirm-db"));
  it("refuses a --confirm-db that names another database", async () => refused(await run({ argv: ["--email", "o@example.com", "--name", "Owner", "--confirm-db", "aayush_carting_test"] }), "--confirm-db"));
  it.each(["--reset-password", "--allow-rerun", "--force", "--role", "--password"])("refuses the option %s (create-only)", async (flag) =>
    refused(await run({ argv: [...GOOD_ARGV, flag, "x"] }), "is not allowed"));
  it("refuses a missing or invalid email and a missing name", async () => {
    refused(await run({ argv: ["--name", "Owner", "--confirm-db", PRODUCTION_DB] }), "--email");
    refused(await run({ argv: ["--email", "nope", "--name", "Owner", "--confirm-db", PRODUCTION_DB] }), "--email");
    refused(await run({ argv: ["--email", "o@example.com", "--name", "A", "--confirm-db", PRODUCTION_DB] }), "--name");
  });
  it("guardProblem is pure and accepts exactly the production database", () => {
    expect(guardProblem({ argv: GOOD_ARGV, uri: PROD_URI })).toBeNull();
    expect(guardProblem({ argv: GOOD_ARGV, uri: `mongodb://localhost:27017/${PRODUCTION_DB}` })).toBeNull();
  });
});

describe("creation", () => {
  it("creates exactly one OWNER with a lower-cased email, after counting, and disconnects", async () => {
    const r = await run();
    expect(r.code).toBe(0);
    expect(r.fake.calls).toEqual(["connect", "init", "count", "create", "disconnect"]);
    expect(r.fake.users).toEqual([{ name: "Aayush Owner", email: "owner@example.com", role: "OWNER", password: PASSWORD }]);
    expect(r.out).toContain("Created OWNER account for owner@example.com");
  });
  it("never prints the password, the connection string, the user name or the secret part of the URI", async () => {
    const r = await run();
    const all = `${r.out}\n${r.err}`;
    for (const secret of [PASSWORD, "SECRET-PW-123", "someuser", "retryWrites"]) expect(all).not.toContain(secret);
    expect(all).toContain(`${PRODUCTION_DB} on cluster.example.net`);
  });
  it("refuses, writes nothing and disconnects when ANY account already exists (any role, any email)", async () => {
    const fake = makeFake({ users: [{ name: "Someone", email: "other@example.com", role: "MANAGER", isActive: false }] });
    const r = await run({ fake });
    expect(r.code).toBe(1);
    expect(r.err).toContain("already exist");
    expect(fake.calls).toEqual(["connect", "init", "count", "disconnect"]);
    expect(fake.users).toHaveLength(1);
  });
  it("reports a duplicate email raised at creation without changing anything", async () => {
    const fake = makeFake();
    fake.services.countUsers = async () => 0; // the race: another run created the same email just after the count
    fake.users.push({ email: "owner@example.com" });
    const r = await run({ fake });
    expect(r.code).toBe(1);
    expect(r.err).toContain("already exists");
    expect(fake.users).toHaveLength(1);
  });
  it("applies the real password policy before connecting (short, spaces, same as email)", async () => {
    for (const bad of ["short", " ".repeat(20), "owner@example.com"]) {
      const r = await run({ password: bad });
      expect(r.code).toBe(1);
      expect(r.err).toContain("not acceptable");
      expect(r.fake.calls).toEqual(["disconnect"]);
      expect(r.fake.users).toEqual([]);
    }
  });
  it("stops cleanly with no terminal, a mismatch or a cancel, before loading any service", async () => {
    for (const message of ["no terminal", "The two passwords do not match", "cancelled"]) {
      const r = await run({ readPassword: async () => Promise.reject(new Error(message)) });
      expect(r.code).toBe(1);
      expect(r.loaded).toBe(0);
      expect(r.fake.calls).toEqual([]);
    }
    expect((await run({ readPassword: async () => Promise.reject(new Error("no terminal")) })).err).toContain("interactive terminal");
  });
  it("reports a connection failure plainly, creates nothing and still disconnects", async () => {
    const fake = makeFake({ connectError: Object.assign(new Error("MongoDB could not be reached within 10 seconds."), { name: "DatabaseConnectionError" }) });
    const r = await run({ fake });
    expect(r.code).toBe(1);
    expect(r.err).toContain("could not be reached");
    expect(fake.calls).toEqual(["connect", "disconnect"]);
  });
  it("initialises the indexes BEFORE counting or creating, and the create never precedes the index check", async () => {
    const fake = makeFake();
    const order = [];
    const { initIndexes, countUsers, createUser } = fake.services;
    fake.services.initIndexes = async () => (order.push("init-start"), await new Promise((r) => setTimeout(r, 20)), order.push("init-done"), initIndexes());
    fake.services.countUsers = async () => (order.push("count"), countUsers());
    fake.services.createUser = async (u) => (order.push("create"), createUser(u));
    expect((await run({ fake })).code).toBe(0);
    expect(order).toEqual(["init-start", "init-done", "count", "create"]);
  });
  it("aborts with nothing created when index initialisation fails", async () => {
    const fake = makeFake({ initError: new Error("index build failed: E11000 duplicate key") });
    const r = await run({ fake });
    expect(r.code).toBe(1);
    expect(r.err).toContain("could not be initialised");
    expect(r.err).toContain("Nothing was created");
    expect(fake.calls).toEqual(["connect", "init", "disconnect"]);
    expect(fake.users).toEqual([]);
  });
  it.each([
    ["no email index", [{ key: { _id: 1 }, name: "_id_" }]],
    ["a non-unique email index", [{ key: { _id: 1 } }, { key: { email: 1 }, name: "email_1" }]],
    ["a compound index that includes email", [{ key: { email: 1, role: 1 }, unique: true }]],
    ["an empty list", []],
    ["no list at all", null],
  ])("aborts with nothing created when the unique email index is missing (%s)", async (_label, indexes) => {
    const fake = makeFake({ indexes });
    const r = await run({ fake });
    expect(r.code).toBe(1);
    expect(r.err).toContain("unique email index");
    expect(fake.calls).toEqual(["connect", "init", "disconnect"]);
    expect(fake.users).toEqual([]);
  });
  it("hasUniqueEmailIndex accepts only a unique single-field email index", () => {
    expect(hasUniqueEmailIndex(GOOD_INDEXES)).toBe(true);
    expect(hasUniqueEmailIndex([{ key: { email: 1 }, unique: false }])).toBe(false);
    expect(hasUniqueEmailIndex([{ key: { email: -1 }, unique: true }])).toBe(false);
    expect(hasUniqueEmailIndex(null)).toBe(false);
  });
  it("a second run after a successful one is refused (one Owner only)", async () => {
    const fake = makeFake();
    expect((await run({ fake })).code).toBe(0);
    const again = await run({ fake });
    expect(again.code).toBe(1);
    expect(fake.users).toHaveLength(1);
  });
});

describe("the real command line (child process; stops before anything can connect)", () => {
  const child = (args, env) => spawnSync(process.execPath, [SCRIPT, ...args], { env: { PATH: process.env.PATH, ...env }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 20_000 });

  it("without MONGODB_URI it refuses (it does not fall back to a .env file)", () => {
    const r = child(GOOD_ARGV, {});
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("not set in this terminal session");
  });
  it("a test database URI is refused", () => {
    const r = child(GOOD_ARGV, { MONGODB_URI: "mongodb://127.0.0.1:1/aayush_carting_test" });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("not \"aayush_carting_prod\"");
  });
  it("--reset-password is refused", () => {
    const r = child([...GOOD_ARGV, "--reset-password"], { MONGODB_URI: "mongodb://127.0.0.1:1/aayush_carting_prod" });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("is not allowed");
  });
  it("with every guard satisfied but no terminal it stops at the password prompt, before connecting", () => {
    const r = child(GOOD_ARGV, { MONGODB_URI: "mongodb://127.0.0.1:1/aayush_carting_prod" });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("interactive terminal");
    expect(r.stdout).not.toContain("Connecting");
  });
  it("OWNER_PASSWORD is ignored (the password only comes from the hidden prompt)", () => {
    const r = child(GOOD_ARGV, { MONGODB_URI: "mongodb://127.0.0.1:1/aayush_carting_prod", OWNER_PASSWORD: PASSWORD });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("interactive terminal");
    expect(r.stdout).not.toContain("Connecting");
  });
});

describe("source checks", () => {
  const source = readFileSync(SCRIPT, "utf8");
  const code = source.split("\n").filter((l) => !l.trim().startsWith("//")).map((l) => l.replace(/\s\/\/ .*$/, "")).join("\n");
  it("has no password reset and does not read OWNER_PASSWORD or any .env file", () => {
    expect(code).not.toMatch(/resetPassword|updateOne|deleteOne|deleteMany|dotenv|readFile|["\x27`]\.env|OWNER_PASSWORD|allow-rerun/);
  });
  it("loads the shared config only inside loadRealServices, after the guards", () => {
    expect(code.split("\n").filter((l) => /^import /.test(l))).toEqual(['import { pathToFileURL } from "node:url";']);
  });
  it("the real services initialise via User.init() before listing indexes, and still only touch the users model", () => {
    expect(code).toMatch(/await User\.init\(\);\s*return User\.collection\.indexes\(\);/);
    expect(code).not.toMatch(/syncIndexes|createIndex|dropIndex/);
    expect(code.match(/import\("\.\.\/models\/[A-Za-z]+\.js"\)/g)).toEqual(['import("../models/User.js")']);
  });
  it("the TEST-only script createOwner.js still refuses production names and has no bypass", () => {
    const owner = readFileSync(fileURLToPath(new URL("../scripts/createOwner.js", import.meta.url)), "utf8");
    expect(owner).toContain('does not end with "_test"');
    expect(owner).toContain("There is deliberately no bypass");
  });
});
