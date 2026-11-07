import { describe, expect, it } from "vitest";
import { validateSeason } from "./seasonValidation";

describe("validateSeason", () => {
  it("accepts an ongoing season and a closed range", () => {
    expect(validateSeason({ name: "Season 2026-27", startDate: "2026-10-01", endDate: "" })).toEqual({});
    expect(validateSeason({ name: "Season 2026-27", startDate: "2026-10-01", endDate: "2027-06-30" })).toEqual({});
    expect(validateSeason({ name: "S", startDate: "2026-10-01", endDate: "2026-10-01" }).name).toBe("Season name is required");
  });
  it("requires a name and a start date, and an end that is not before the start", () => {
    expect(validateSeason({ name: " ", startDate: "" })).toEqual({ name: "Season name is required", startDate: "Start date is required" });
    expect(validateSeason({ name: "Season", startDate: "2026-10-01", endDate: "2026-09-30" }).endDate).toMatch(/on or after/);
    expect(validateSeason({ name: "x".repeat(61), startDate: "2026-10-01" }).name).toBe("Season name is too long");
  });
});
