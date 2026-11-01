import { describe, expect, it } from "vitest";
import {
  addDays,
  businessDayToUtcRange,
  businessRangeToUtcRange,
  diffDays,
  isFutureBusinessDate,
  isValidBusinessDate,
  toBusinessDate,
  todayBusinessDate,
} from "../utils/dates.js";

describe("isValidBusinessDate", () => {
  it.each(["2026-10-31", "2024-02-29", "2026-01-01"])("accepts %s", (d) => expect(isValidBusinessDate(d)).toBe(true));
  it.each(["2026-02-30", "2025-02-29", "2026-13-01", "2026-00-10", "2026-1-1", "31-10-2026", "2026-10-31T00:00:00Z", "", null, undefined, 20261031])(
    "rejects %j",
    (d) => expect(isValidBusinessDate(d)).toBe(false)
  );
});

describe("toBusinessDate (India, UTC+05:30)", () => {
  it("moves to the next day after 18:30 UTC", () => {
    expect(toBusinessDate(new Date("2026-10-31T18:29:59Z"))).toBe("2026-10-31");
    expect(toBusinessDate(new Date("2026-10-31T18:30:00Z"))).toBe("2026-11-01");
  });

  it("is the same whatever timezone the server runs in", () => {
    // The user's own message time: Sun 2026-11-01 09:17 IST = 03:47 UTC
    expect(todayBusinessDate(new Date("2026-11-01T03:47:00Z"))).toBe("2026-11-01");
    // 00:10 IST on 1 Nov is still 31 Oct in UTC: a UTC-based "today" would be a day early
    expect(todayBusinessDate(new Date("2026-10-31T18:40:00Z"))).toBe("2026-11-01");
    expect(new Date("2026-10-31T18:40:00Z").toISOString().slice(0, 10)).toBe("2026-10-31");
  });
});

describe("isFutureBusinessDate", () => {
  const now = new Date("2026-11-01T03:47:00Z"); // 1 Nov, IST
  it("compares against today in India", () => {
    expect(isFutureBusinessDate("2026-11-01", now)).toBe(false);
    expect(isFutureBusinessDate("2026-10-31", now)).toBe(false);
    expect(isFutureBusinessDate("2026-11-02", now)).toBe(true);
  });
  it("treats 1 Nov as today at 00:10 IST even though UTC is still 31 Oct", () => {
    expect(isFutureBusinessDate("2026-11-01", new Date("2026-10-31T18:40:00Z"))).toBe(false);
  });
});

describe("addDays / diffDays", () => {
  it("handles month, year and leap-day boundaries", () => {
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2026-11-01", -6)).toBe("2026-10-26");
  });
  it("counts days", () => {
    expect(diffDays("2026-10-26", "2026-11-01")).toBe(6);
    expect(diffDays("2026-11-01", "2026-11-01")).toBe(0);
  });
  it("rejects invalid dates", () => {
    expect(() => addDays("2026-02-30", 1)).toThrow(RangeError);
  });
});

describe("UTC bounds of a business day", () => {
  it("starts at 18:30 UTC the evening before", () => {
    const { start, endExclusive } = businessDayToUtcRange("2026-11-01");
    expect(start.toISOString()).toBe("2026-10-31T18:30:00.000Z");
    expect(endExclusive.toISOString()).toBe("2026-11-01T18:30:00.000Z");
  });
  it("a range is inclusive of its last day", () => {
    const { start, endExclusive } = businessRangeToUtcRange("2026-10-26", "2026-11-01");
    expect(start.toISOString()).toBe("2026-10-25T18:30:00.000Z");
    expect(endExclusive.toISOString()).toBe("2026-11-01T18:30:00.000Z");
  });
  it("rejects a reversed range", () => {
    expect(() => businessRangeToUtcRange("2026-11-02", "2026-11-01")).toThrow(RangeError);
  });
});
