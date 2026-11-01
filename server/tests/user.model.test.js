import { describe, expect, it } from "vitest";
import User from "../models/User.js";

const valid = { name: "Ramesh Patel", email: "Owner@Example.com ", passwordHash: "$2b$12$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ0123" };
const errorsOf = (data) => new User(data).validateSync()?.errors ?? {};

describe("User model", () => {
  it("accepts a valid account and normalises the email", () => {
    const user = new User(valid);
    expect(user.validateSync()).toBeUndefined();
    expect(user.email).toBe("owner@example.com");
    expect(user.role).toBe("OWNER");
    expect(user.isActive).toBe(true);
    expect(user.tokenVersion).toBe(0);
  });

  it("requires a name, email and password hash", () => {
    const errors = errorsOf({});
    expect(Object.keys(errors).sort()).toEqual(["email", "name", "passwordHash"]);
  });

  it("rejects a bad email and an unknown role", () => {
    expect(errorsOf({ ...valid, email: "not-an-email" }).email).toBeDefined();
    expect(errorsOf({ ...valid, role: "ADMIN" }).role).toBeDefined();
    expect(errorsOf({ ...valid, role: "MANAGER" }).role).toBeUndefined();
  });

  it("keeps the hash out of queries by default and out of JSON", () => {
    expect(User.schema.path("passwordHash").options.select).toBe(false);
    const user = new User(valid);
    expect(user.toJSON().passwordHash).toBeUndefined();
    expect(user.toObject().passwordHash).toBeUndefined();
    expect(JSON.stringify(user)).not.toContain("$2b$");
    expect(typeof user.toJSON().id).toBe("string");
  });

  it("has a unique index on email and drops unknown fields", () => {
    expect(User.schema.indexes().some(([fields, options]) => fields.email === 1 && options.unique)).toBe(true);
    expect(new User({ ...valid, isAdminForReal: true }).get("isAdminForReal")).toBeUndefined();
  });
});
