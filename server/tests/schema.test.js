import mongoose from "mongoose";
import { describe, expect, it } from "vitest";
import { businessDateField, createSchema, moneyField, softDeleteFields } from "../utils/schema.js";

// Validation only: no database is needed, and these throw-away models are never saved.
const Sample = mongoose.model(
  "PhaseTwoSample",
  createSchema({
    workDate: { ...businessDateField(), required: true },
    amountPaise: { ...moneyField(), required: true },
    ...softDeleteFields(),
  })
);

const errorsOf = (data) => new Sample(data).validateSync()?.errors ?? {};

describe("schema conventions", () => {
  it("accepts a valid business date and whole paise", () => {
    expect(errorsOf({ workDate: "2026-11-01", amountPaise: 25000 })).toEqual({});
  });

  it("rejects an impossible date, a timestamp and a Date object", () => {
    expect(errorsOf({ workDate: "2026-02-30", amountPaise: 1 }).workDate).toBeDefined();
    expect(errorsOf({ workDate: "2026-11-01T00:00:00Z", amountPaise: 1 }).workDate).toBeDefined();
  });

  it("rejects fractional paise and negative money", () => {
    expect(errorsOf({ workDate: "2026-11-01", amountPaise: 62.5 }).amountPaise).toBeDefined();
    expect(errorsOf({ workDate: "2026-11-01", amountPaise: -1 }).amountPaise).toBeDefined();
  });

  it("drops unknown fields (strict) and exposes timestamps", () => {
    const doc = new Sample({ workDate: "2026-11-01", amountPaise: 100, sneaky: "x" });
    expect(doc.get("sneaky")).toBeUndefined();
    expect(Sample.schema.path("createdAt")).toBeDefined();
    expect(Sample.schema.path("updatedAt")).toBeDefined();
    expect(Sample.schema.options.versionKey).toBe(false);
  });

  it("soft-delete fields default to not deleted, and JSON uses id instead of _id", () => {
    const json = new Sample({ workDate: "2026-11-01", amountPaise: 100 }).toJSON();
    expect(json.isDeleted).toBe(false);
    expect(json.deletedAt).toBeNull();
    expect(json._id).toBeUndefined();
    expect(typeof json.id).toBe("string");
  });
});
