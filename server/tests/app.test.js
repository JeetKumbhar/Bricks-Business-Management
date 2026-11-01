import express from "express";
import request from "supertest";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// The health route asks the database module for its state; tests control that answer.
const { getDbStatus } = vi.hoisted(() => ({ getDbStatus: vi.fn() }));
vi.mock("../config/db.js", () => ({ getDbStatus }));

process.env.NODE_ENV = "test";
process.env.CLIENT_ORIGIN = "http://localhost:5173, https://app.example.com/";

let createApp;
let app;
beforeAll(async () => {
  ({ createApp } = await import("../app.js"));
  app = createApp();
});

describe("GET /api/health", () => {
  beforeEach(() => getDbStatus.mockResolvedValue({ status: "connected", name: "brickpro" }));

  it("returns the documented success response when the database is connected", async () => {
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/json/);
    expect(res.body).toMatchObject({
      success: true,
      message: "Server is healthy",
      data: { status: "ok", environment: "test", database: { status: "connected", name: "brickpro" } },
    });
    expect(typeof res.body.data.uptimeSeconds).toBe("number");
    expect(new Date(res.body.data.timestamp).toString()).not.toBe("Invalid Date");
  });

  it.each(["disconnected", "connecting", "unreachable"])("returns 503 when the database is %s", async (status) => {
    getDbStatus.mockResolvedValue({ status });
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({
      success: false,
      message: "Server is running but the database is not available",
      data: { status: "degraded", database: { status } },
    });
  });

  it("does not advertise Express", async () => {
    const res = await request(app).get("/api/health");
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });
});

describe("404 handling", () => {
  it("returns a controlled JSON 404 for an unknown route", async () => {
    const res = await request(app).get("/api/nope?x=1");
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ success: false, message: "Route not found: GET /api/nope" });
  });

  it("404s on an unsupported method of a known path", async () => {
    const res = await request(app).post("/api/health");
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });
});

describe("error handling", () => {
  it("returns 400 for malformed JSON", async () => {
    const res = await request(app).post("/api/anything").set("Content-Type", "application/json").send('{"bad":');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ success: false, message: "Request body is not valid JSON" });
  });

  it("returns 413 for an oversized body", async () => {
    const res = await request(app)
      .post("/api/anything")
      .set("Content-Type", "application/json")
      .send(JSON.stringify({ blob: "x".repeat(1_100_000) }));
    expect(res.status).toBe(413);
    expect(res.body.success).toBe(false);
  });

  it("keeps ApiError details and hides unexpected ones in production", async () => {
    const { default: ApiError } = await import("../utils/ApiError.js");
    const { default: asyncHandler } = await import("../utils/asyncHandler.js");
    const { default: errorHandler } = await import("../middlewares/error.middleware.js");

    const probe = express();
    probe.get("/known", (_req, _res, next) => next(ApiError.badRequest("Validation failed", [{ field: "mobile", message: "Required" }])));
    probe.get("/async", asyncHandler(async () => {
      throw new Error("secret database detail");
    }));
    probe.use(errorHandler);

    const known = await request(probe).get("/known");
    expect(known.status).toBe(400);
    expect(known.body).toEqual({ success: false, message: "Validation failed", errors: [{ field: "mobile", message: "Required" }] });

    const unexpected = await request(probe).get("/async");
    expect(unexpected.status).toBe(500);
    expect(unexpected.body.success).toBe(false);
    expect(unexpected.body.message).toBe("Something went wrong on the server");
  });
});

describe("CORS", () => {
  it("allows the configured origin (and a trimmed, slash-stripped second one)", async () => {
    for (const origin of ["http://localhost:5173", "https://app.example.com"]) {
      const res = await request(app).get("/api/health").set("Origin", origin);
      expect(res.headers["access-control-allow-origin"]).toBe(origin);
    }
  });

  it("answers the preflight for the configured origin", async () => {
    const res = await request(app)
      .options("/api/health")
      .set("Origin", "http://localhost:5173")
      .set("Access-Control-Request-Method", "PATCH")
      .set("Access-Control-Request-Headers", "content-type,authorization");
    expect(res.status).toBe(204);
    expect(res.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
    expect(res.headers["access-control-allow-methods"]).toContain("PATCH");
  });

  it("sends no CORS headers to another origin", async () => {
    const res = await request(app).get("/api/health").set("Origin", "https://evil.example");
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });
});
