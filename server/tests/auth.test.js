import bcrypt from "bcryptjs";
import cookieParser from "cookie-parser";
import express from "express";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.NODE_ENV = "test";
  process.env.BCRYPT_ROUNDS = "4"; // fast hashing for tests; production uses 12
  process.env.CLIENT_ORIGIN = "http://localhost:5173";
  process.env.JWT_SECRET = "unit-test-secret-that-is-long-enough-0123456789";
});

// ---- An in-memory stand-in for the users collection (there is no database in the tests) ----
const store = vi.hoisted(() => ({ users: [] }));

vi.mock("../config/db.js", () => ({ getDbStatus: async () => ({ status: "connected", name: "test" }) }));

vi.mock("../models/User.js", () => {
  const matches = (user, filter) => Object.entries(filter).every(([key, value]) => String(user[key]) === String(value));
  // Mimics `Model.find...(...).select(...).lean()`: the hash is only present when "+passwordHash" was selected.
  const query = (find) => {
    let withHash = false;
    const api = {
      select(fields) {
        withHash = String(fields).includes("+passwordHash");
        return api;
      },
      lean: () => api,
      then(resolve, reject) {
        return Promise.resolve()
          .then(() => {
            const found = find();
            if (!found) return null;
            const copy = { ...found };
            if (!withHash) delete copy.passwordHash;
            return copy;
          })
          .then(resolve, reject);
      },
    };
    return api;
  };
  return {
    default: {
      findOne: (filter) => query(() => store.users.find((u) => matches(u, filter))),
      findById: (id) => query(() => store.users.find((u) => String(u._id) === String(id))),
      updateOne: async (filter, update) => {
        const user = store.users.find((u) => matches(u, filter));
        if (user) {
          Object.assign(user, update.$set ?? {});
          for (const [key, by] of Object.entries(update.$inc ?? {})) user[key] = (user[key] ?? 0) + by;
        }
        return { matchedCount: user ? 1 : 0 };
      },
      create: async (doc) => {
        if (store.users.some((u) => u.email === doc.email)) throw Object.assign(new Error("duplicate key"), { code: 11000 });
        const user = { _id: new mongoose.Types.ObjectId().toString(), isActive: true, tokenVersion: 0, lastLoginAt: null, ...doc };
        store.users.push(user);
        return { ...user };
      },
    },
  };
});

const { createApp } = await import("../app.js");
const { default: requireAuth } = await import("../middlewares/auth.middleware.js");
const { requireRole } = await import("../middlewares/role.middleware.js");
const { default: errorHandler } = await import("../middlewares/error.middleware.js");
const { createUser, hashPassword, checkPasswordPolicy, resetPassword } = await import("../services/auth.service.js");

const PASSWORD = "correct horse battery staple";
const EMAIL = "owner@example.com";
const SECRET = process.env.JWT_SECRET;

const addUser = async (overrides = {}) => {
  const user = {
    _id: new mongoose.Types.ObjectId().toString(),
    name: "Ramesh Patel",
    email: EMAIL,
    passwordHash: await hashPassword(PASSWORD),
    role: "OWNER",
    isActive: true,
    tokenVersion: 0,
    lastLoginAt: null,
    ...overrides,
  };
  store.users.push(user);
  return user;
};

const cookieFrom = (res) => res.headers["set-cookie"]?.find((c) => c.startsWith("brickpro_token="));
const cookiePair = (res) => cookieFrom(res).split(";")[0];

const loginAs = async (app, email = EMAIL, password = PASSWORD) => request(app).post("/api/auth/login").send({ email, password });

let app;
beforeEach(() => {
  store.users.length = 0;
  app = createApp();
});
afterEach(() => vi.restoreAllMocks());

// ---------------------------------------------------------------------------
describe("passwords are never stored in plain text", () => {
  it("createUser stores only a bcrypt hash that verifies", async () => {
    const user = await createUser({ name: "Ramesh Patel", email: EMAIL, password: PASSWORD });
    const stored = store.users[0];
    expect(stored.passwordHash).toMatch(/^\$2[aby]\$04\$/);
    expect(stored.passwordHash).not.toContain(PASSWORD);
    expect(JSON.stringify(stored)).not.toContain(PASSWORD);
    expect(await bcrypt.compare(PASSWORD, stored.passwordHash)).toBe(true);
    expect(user).toEqual({ id: stored._id, name: "Ramesh Patel", email: EMAIL, role: "OWNER" });
  });

  it("the same password hashes differently each time (salted)", async () => {
    expect(await hashPassword(PASSWORD)).not.toBe(await hashPassword(PASSWORD));
  });

  it("rejects a duplicate email and a weak password", async () => {
    await createUser({ name: "Ramesh Patel", email: EMAIL, password: PASSWORD });
    await expect(createUser({ name: "Other", email: EMAIL, password: PASSWORD })).rejects.toMatchObject({ code: "EMAIL_TAKEN" });
    await expect(createUser({ name: "Other", email: "b@example.com", password: "short" })).rejects.toMatchObject({ code: "WEAK_PASSWORD" });
    expect(store.users).toHaveLength(1);
  });

  it("password policy", () => {
    expect(checkPasswordPolicy(PASSWORD)).toEqual([]);
    expect(checkPasswordPolicy("short")).toHaveLength(1);
    expect(checkPasswordPolicy("            ")).not.toEqual([]);
    expect(checkPasswordPolicy("x".repeat(73))).not.toEqual([]); // bcrypt would ignore the tail
    expect(checkPasswordPolicy("ünïcödé".repeat(6))).toEqual([]); // 42 characters, 66 bytes: fine
    expect(checkPasswordPolicy("ünïcödé".repeat(7))).not.toEqual([]); // 49 characters but 77 bytes: the limit counts bytes
    expect(checkPasswordPolicy("OWNER@example.com", { email: "owner@example.com" })).not.toEqual([]);
    expect(checkPasswordPolicy(undefined)).toEqual(["Password is required"]);
  });

  it("resetPassword changes the hash and signs everyone out", async () => {
    const user = await addUser();
    const before = user.passwordHash;
    expect(await resetPassword(EMAIL, "a brand new long password")).toBe(true);
    expect(user.passwordHash).not.toBe(before);
    expect(user.tokenVersion).toBe(1);
    expect(await resetPassword("nobody@example.com", "a brand new long password")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe("POST /api/auth/login: valid login", () => {
  it("signs a valid owner in with an HTTP-only cookie and no token in the body", async () => {
    const user = await addUser();
    const res = await loginAs(app);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      message: "Logged in successfully",
      data: { user: { id: user._id, name: "Ramesh Patel", email: EMAIL, role: "OWNER" } },
    });
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|tokenVersion|\$2[aby]\$/);

    const cookie = cookieFrom(res);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(/Path=\/api/);
    expect(cookie).toMatch(/Expires=/);
    expect(cookie).not.toMatch(/Secure/i); // test mode is not production and SameSite is not "none"
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(user.lastLoginAt).toBeInstanceOf(Date);
  });

  it("the token holds only the account id, a version and standard claims", async () => {
    const user = await addUser();
    const res = await loginAs(app);
    const payload = jwt.verify(cookiePair(res).split("=")[1], SECRET);
    expect(Object.keys(payload).sort()).toEqual(["exp", "iat", "iss", "sub", "ver"]);
    expect(payload.sub).toBe(user._id);
    expect(payload.exp - payload.iat).toBe(12 * 60 * 60);
  });

  it("is case-insensitive and trims the email", async () => {
    await addUser();
    const res = await loginAs(app, "  OWNER@Example.COM ");
    expect(res.status).toBe(200);
  });

  it("the cookie then opens GET /api/auth/me", async () => {
    await addUser();
    const login = await loginAs(app);
    const me = await request(app).get("/api/auth/me").set("Cookie", cookiePair(login));
    expect(me.status).toBe(200);
    expect(me.body.data.user).toMatchObject({ email: EMAIL, role: "OWNER", name: "Ramesh Patel" });
    expect(JSON.stringify(me.body)).not.toMatch(/passwordHash/);
  });
});

// ---------------------------------------------------------------------------
describe("POST /api/auth/login: invalid credentials are rejected safely", () => {
  it("gives the identical response for a wrong password and an unknown email", async () => {
    await addUser();
    const wrongPassword = await loginAs(app, EMAIL, "not the right password");
    const unknownEmail = await loginAs(app, "nobody@example.com", PASSWORD);

    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(wrongPassword.body).toEqual({ success: false, message: "Invalid email or password" });
    expect(unknownEmail.body).toEqual(wrongPassword.body);
    expect(cookieFrom(wrongPassword)).toBeUndefined();
    expect(cookieFrom(unknownEmail)).toBeUndefined();
  });

  it("a disabled account looks exactly like a wrong password", async () => {
    await addUser({ isActive: false });
    const res = await loginAs(app);
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ success: false, message: "Invalid email or password" });
  });

  it("does the same amount of hashing work for an unknown email (no timing tell)", async () => {
    await addUser();
    const compare = vi.spyOn(bcrypt, "compare");
    await loginAs(app, "nobody@example.com", PASSWORD);
    await loginAs(app, EMAIL, "wrong password entirely");
    expect(compare).toHaveBeenCalledTimes(2);
  });

  it("a password longer than bcrypt's 72 bytes can never log in, even as a prefix match", async () => {
    await addUser({ passwordHash: await hashPassword("a".repeat(72)) });
    const res = await loginAs(app, EMAIL, "a".repeat(72) + "extra");
    expect(res.status).toBe(401);
  });

  it.each([
    ["no body", undefined],
    ["empty object", {}],
    ["missing password", { email: EMAIL }],
    ["missing email", { password: PASSWORD }],
    ["empty password", { email: EMAIL, password: "" }],
    ["not an email", { email: "owner", password: PASSWORD }],
    ["password too long", { email: EMAIL, password: "x".repeat(129) }],
    ["extra field", { email: EMAIL, password: PASSWORD, role: "OWNER" }],
    ["query operator instead of an email", { email: { $gt: "" }, password: PASSWORD }],
    ["query operator instead of a password", { email: EMAIL, password: { $ne: "x" } }],
    ["numbers", { email: 1, password: 2 }],
  ])("rejects %s with 400 before touching the database", async (_name, body) => {
    await addUser();
    const res = await request(app).post("/api/auth/login").send(body);
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toBe("Validation failed");
    expect(Array.isArray(res.body.errors)).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain(PASSWORD);
  });

  it("never echoes the submitted password in an error", async () => {
    const secret = "my-secret-typed-password";
    const res = await request(app).post("/api/auth/login").send({ email: "not-an-email", password: secret });
    expect(JSON.stringify(res.body)).not.toContain(secret);
  });
});

// ---------------------------------------------------------------------------
describe("private routes reject unauthenticated requests", () => {
  it("GET /api/auth/me needs a login", async () => {
    const res = await request(app).get("/api/auth/me");
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ success: false, message: "Authentication required" });
  });

  it("every other /api path is private by default, whatever the method", async () => {
    for (const method of ["get", "post", "put", "patch", "delete"]) {
      const res = await request(app)[method]("/api/labours/anything");
      expect(res.status, method).toBe(401);
    }
  });

  it("health and login stay public; paths outside /api are plain 404s", async () => {
    expect((await request(app).get("/api/health")).status).toBe(200);
    expect((await request(app).post("/api/auth/login").send({})).status).toBe(400); // reached validation, not blocked
    expect((await request(app).get("/nope")).status).toBe(404);
  });

  it("a signed-in user gets a controlled 404 for an unknown route", async () => {
    await addUser();
    const login = await loginAs(app);
    const res = await request(app).get("/api/nope").set("Cookie", cookiePair(login));
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ success: false, message: "Route not found: GET /api/nope" });
  });

  it("rejects a garbage cookie and clears it", async () => {
    const res = await request(app).get("/api/auth/me").set("Cookie", "brickpro_token=not-a-jwt");
    expect(res.status).toBe(401);
    expect(cookieFrom(res)).toMatch(/brickpro_token=;/);
  });

  describe("bad tokens", () => {
    const get = (token) => request(app).get("/api/auth/me").set("Cookie", `brickpro_token=${token}`);
    const base = { algorithm: "HS256", issuer: "brickpro" };

    it("rejects an expired token", async () => {
      const user = await addUser();
      const token = jwt.sign({ ver: 0 }, SECRET, { ...base, subject: user._id, expiresIn: -10 });
      expect((await get(token)).status).toBe(401);
    });

    it("rejects a token signed with another secret", async () => {
      const user = await addUser();
      const token = jwt.sign({ ver: 0 }, "some-other-secret-that-is-also-long-enough!!", { ...base, subject: user._id, expiresIn: "1h" });
      expect((await get(token)).status).toBe(401);
    });

    it("rejects a tampered token", async () => {
      await addUser();
      const login = await loginAs(app);
      const token = cookiePair(login).split("=")[1];
      const [h, p, s] = token.split(".");
      const forgedPayload = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(p, "base64url")), sub: "0".repeat(24) })).toString("base64url");
      expect((await get(`${h}.${forgedPayload}.${s}`)).status).toBe(401);
    });

    it('rejects an unsigned token ("alg": "none")', async () => {
      const user = await addUser();
      const enc = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
      const token = `${enc({ alg: "none", typ: "JWT" })}.${enc({ sub: user._id, ver: 0, iss: "brickpro", exp: 9999999999 })}.`;
      expect((await get(token)).status).toBe(401);
    });

    it("rejects a token from a different issuer", async () => {
      const user = await addUser();
      const token = jwt.sign({ ver: 0 }, SECRET, { algorithm: "HS256", issuer: "someone-else", subject: user._id, expiresIn: "1h" });
      expect((await get(token)).status).toBe(401);
    });

    it("rejects a token whose account no longer exists", async () => {
      const token = jwt.sign({ ver: 0 }, SECRET, { ...base, subject: new mongoose.Types.ObjectId().toString(), expiresIn: "1h" });
      expect((await get(token)).status).toBe(401);
    });

    it("rejects a subject that is not a valid id", async () => {
      const token = jwt.sign({ ver: 0 }, SECRET, { ...base, subject: "{ $ne: null }", expiresIn: "1h" });
      expect((await get(token)).status).toBe(401);
    });

    it("stops working the moment the account is disabled", async () => {
      const user = await addUser();
      const login = await loginAs(app);
      expect((await request(app).get("/api/auth/me").set("Cookie", cookiePair(login))).status).toBe(200);
      user.isActive = false;
      expect((await request(app).get("/api/auth/me").set("Cookie", cookiePair(login))).status).toBe(401);
    });

    it("stops working after a password reset (token version changed)", async () => {
      await addUser();
      const login = await loginAs(app);
      await resetPassword(EMAIL, "a brand new long password");
      expect((await request(app).get("/api/auth/me").set("Cookie", cookiePair(login))).status).toBe(401);
      expect((await loginAs(app, EMAIL, "a brand new long password")).status).toBe(200);
    });

    it("takes the role from the database, not from the token", async () => {
      const user = await addUser({ role: "STAFF" });
      const token = jwt.sign({ ver: 0, role: "OWNER" }, SECRET, { ...base, subject: user._id, expiresIn: "1h" });
      const res = await get(token);
      expect(res.body.data.user.role).toBe("STAFF");
    });
  });
});

// ---------------------------------------------------------------------------
describe("POST /api/auth/logout", () => {
  it("clears the cookie, whether or not anyone is signed in", async () => {
    for (const headers of [{}, { Cookie: "brickpro_token=whatever" }]) {
      const res = await request(app).post("/api/auth/logout").set(headers);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, message: "Logged out successfully", data: null });
      expect(cookieFrom(res)).toMatch(/brickpro_token=;.*Expires=Thu, 01 Jan 1970/);
      expect(cookieFrom(res)).toMatch(/Path=\/api/);
    }
  });
});

// ---------------------------------------------------------------------------
describe("login rate limiting", () => {
  it("blocks the 4th failed attempt in a window of 3, even with the right password", async () => {
    await addUser();
    const limited = createApp({ loginRateLimit: { limit: 3, windowMs: 60_000 } });
    for (let i = 0; i < 3; i += 1) expect((await loginAs(limited, EMAIL, "wrong password here")).status).toBe(401);

    const blocked = await loginAs(limited, EMAIL, PASSWORD);
    expect(blocked.status).toBe(429);
    expect(blocked.body).toEqual({ success: false, message: "Too many login attempts. Please try again later." });
    expect(blocked.headers["ratelimit-policy"] ?? blocked.headers["ratelimit"]).toBeDefined();
    expect(cookieFrom(blocked)).toBeUndefined();
  });

  it("does not count successful logins", async () => {
    await addUser();
    const limited = createApp({ loginRateLimit: { limit: 3, windowMs: 60_000 } });
    for (let i = 0; i < 6; i += 1) expect((await loginAs(limited)).status).toBe(200);
  });

  it("uses 10 failures per 15 minutes by default", async () => {
    const { LOGIN_MAX_FAILURES, LOGIN_WINDOW_MS } = await import("../middlewares/rateLimit.middleware.js");
    expect(LOGIN_MAX_FAILURES).toBe(10);
    expect(LOGIN_WINDOW_MS).toBe(15 * 60 * 1000);
  });
});

// ---------------------------------------------------------------------------
describe("cross-site request forgery guard", () => {
  it("refuses a change-making request from an origin that is not the frontend", async () => {
    await addUser();
    const res = await request(app).post("/api/auth/login").set("Origin", "https://evil.example").send({ email: EMAIL, password: PASSWORD });
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ success: false, message: "Origin not allowed" });
    expect(cookieFrom(res)).toBeUndefined();
  });

  it("allows the configured frontend origin and requests without an Origin header", async () => {
    await addUser();
    const fromFrontend = await request(app).post("/api/auth/login").set("Origin", "http://localhost:5173").send({ email: EMAIL, password: PASSWORD });
    expect(fromFrontend.status).toBe(200);
    expect(fromFrontend.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
    expect(fromFrontend.headers["access-control-allow-credentials"]).toBe("true");
    expect((await loginAs(app)).status).toBe(200);
  });

  it("does not block reads", async () => {
    expect((await request(app).get("/api/health").set("Origin", "https://evil.example")).status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
describe("requireRole", () => {
  const roleApp = () => {
    const a = express();
    a.use(cookieParser());
    a.get("/owner-only", requireAuth, requireRole("OWNER"), (req, res) => res.json({ ok: true, role: req.user.role }));
    a.get("/no-auth-check", requireRole("OWNER"), (_req, res) => res.json({ ok: true }));
    a.use(errorHandler);
    return a;
  };

  it("lets the right role in and turns others away with 403", async () => {
    await addUser();
    await addUser({ email: "staff@example.com", role: "STAFF" });
    const owner = await loginAs(app);
    const staff = await loginAs(app, "staff@example.com");

    const ok = await request(roleApp()).get("/owner-only").set("Cookie", cookiePair(owner));
    expect(ok.status).toBe(200);
    expect(ok.body.role).toBe("OWNER");

    const denied = await request(roleApp()).get("/owner-only").set("Cookie", cookiePair(staff));
    expect(denied.status).toBe(403);
    expect(denied.body).toEqual({ success: false, message: "You do not have permission to do this" });
  });

  it("answers 401 when used without requireAuth", async () => {
    expect((await request(roleApp()).get("/no-auth-check")).status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
describe("secrets are not logged", () => {
  it("prints neither the password, the hash nor the token during logins, failures and errors", async () => {
    const user = await addUser();
    const output = [];
    for (const method of ["log", "info", "warn", "error", "debug"]) vi.spyOn(console, method).mockImplementation((...a) => output.push(a.map(String).join(" ")));

    const ok = await loginAs(app);
    await loginAs(app, EMAIL, "wrong password entirely");
    await loginAs(app, "nobody@example.com", "another wrong password");
    await request(app).get("/api/auth/me").set("Cookie", "brickpro_token=garbage");
    const token = cookiePair(ok).split("=")[1];

    const text = output.join("\n");
    for (const secret of [PASSWORD, "wrong password entirely", "another wrong password", user.passwordHash, token, SECRET]) {
      expect(text).not.toContain(secret);
    }
  });
});
