import { afterEach, describe, expect, it, vi } from "vitest";

// These tests must never read a real server/.env (it would fill the variables back in, and a failure would print them).
vi.mock("dotenv", () => ({ default: { config: () => ({}) } }));

// env.js reads process.env when it is first imported, so each case imports a fresh copy.
const KEYS = ["NODE_ENV", "JWT_SECRET", "JWT_EXPIRES_IN", "COOKIE_SAME_SITE", "BCRYPT_ROUNDS", "TRUST_PROXY", "CLIENT_ORIGIN"];
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
const GOOD = "a-long-random-secret-for-this-test-0123456789";

const load = async (vars) => {
  for (const k of KEYS) delete process.env[k];
  Object.assign(process.env, vars);
  vi.resetModules();
  return import("../config/env.js");
};

afterEach(() => {
  for (const k of KEYS) (saved[k] === undefined ? delete process.env[k] : (process.env[k] = saved[k]));
  vi.resetModules();
});

describe("authentication settings", () => {
  it("refuses to start without a JWT secret outside tests", async () => {
    await expect(load({ NODE_ENV: "development" })).rejects.toThrow(/JWT_SECRET is not set/);
    await expect(load({ NODE_ENV: "production", CLIENT_ORIGIN: "https://app.example.com" })).rejects.toThrow(/JWT_SECRET is not set/);
  });

  it("refuses a short secret", async () => {
    await expect(load({ NODE_ENV: "development", JWT_SECRET: "too-short" })).rejects.toThrow(/at least 32 characters/);
  });

  it("uses a throw-away secret only in test mode", async () => {
    const { env } = await load({ NODE_ENV: "test" });
    expect(env.jwtSecret.length).toBeGreaterThanOrEqual(32);
  });

  it("applies safe defaults", async () => {
    const { env } = await load({ NODE_ENV: "development", JWT_SECRET: GOOD });
    expect(env).toMatchObject({ jwtExpiresIn: "12h", cookieSameSite: "lax", cookieSecure: false, bcryptRounds: 12, trustProxy: 0 });
  });

  it("makes the cookie Secure in production and whenever SameSite is none", async () => {
    const prod = await load({ NODE_ENV: "production", JWT_SECRET: GOOD, CLIENT_ORIGIN: "https://app.example.com" });
    expect(prod.env.cookieSecure).toBe(true);
    const none = await load({ NODE_ENV: "development", JWT_SECRET: GOOD, COOKIE_SAME_SITE: "none" });
    expect(none.env.cookieSecure).toBe(true);
  });

  it.each([
    [{ JWT_EXPIRES_IN: "forever" }, /JWT_EXPIRES_IN/],
    [{ JWT_EXPIRES_IN: "12" }, /JWT_EXPIRES_IN/],
    [{ COOKIE_SAME_SITE: "whenever" }, /COOKIE_SAME_SITE/],
    [{ BCRYPT_ROUNDS: "5" }, /BCRYPT_ROUNDS/],
    [{ BCRYPT_ROUNDS: "40" }, /BCRYPT_ROUNDS/],
    [{ TRUST_PROXY: "-1" }, /TRUST_PROXY/],
  ])("rejects %j", async (vars, message) => {
    await expect(load({ NODE_ENV: "development", JWT_SECRET: GOOD, ...vars })).rejects.toThrow(message);
  });

  it("allows cheap hashing only in tests", async () => {
    await expect(load({ NODE_ENV: "test", BCRYPT_ROUNDS: "4" })).resolves.toBeDefined();
    await expect(load({ NODE_ENV: "production", JWT_SECRET: GOOD, BCRYPT_ROUNDS: "4", CLIENT_ORIGIN: "https://a.example.com" })).rejects.toThrow(/BCRYPT_ROUNDS/);
  });
});
