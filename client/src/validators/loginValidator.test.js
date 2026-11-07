import { describe, expect, it } from "vitest";
import { loginResolver, validateLogin } from "./loginValidator";

describe("validateLogin", () => {
  it("accepts a normal email and password", () => {
    expect(validateLogin({ email: "owner@example.com", password: "x" })).toEqual({});
    expect(validateLogin({ email: "  owner@example.com  ", password: "a long password 123" })).toEqual({});
  });

  it("requires both fields", () => {
    expect(validateLogin({})).toEqual({ email: "Email is required", password: "Password is required" });
    expect(validateLogin({ email: "   ", password: "" })).toEqual({ email: "Email is required", password: "Password is required" });
  });

  it("rejects a malformed email and an over-long password (same limits as the server)", () => {
    expect(validateLogin({ email: "not-an-email", password: "x" }).email).toBe("Enter a valid email address");
    expect(validateLogin({ email: "a@b", password: "x" }).email).toBe("Enter a valid email address");
    expect(validateLogin({ email: `${"a".repeat(250)}@x.com`, password: "x" }).email).toBe("Enter a valid email address");
    expect(validateLogin({ email: "a@b.co", password: "p".repeat(129) }).password).toBe("Password is too long");
    expect(validateLogin({ email: "a@b.co", password: "p".repeat(128) })).toEqual({});
  });

  it("does not trim the password (spaces can be part of it)", () => {
    expect(validateLogin({ email: "a@b.co", password: "   " })).toEqual({});
  });
});

describe("loginResolver", () => {
  it("returns cleaned values when valid", async () => {
    expect(await loginResolver({ email: " Owner@Example.com ", password: "pw" })).toEqual({ values: { email: "Owner@Example.com", password: "pw" }, errors: {} });
  });

  it("returns react-hook-form style errors when invalid", async () => {
    const res = await loginResolver({ email: "", password: "" });
    expect(res.values).toEqual({});
    expect(res.errors.email).toEqual({ type: "validate", message: "Email is required" });
    expect(res.errors.password.message).toBe("Password is required");
  });
});
