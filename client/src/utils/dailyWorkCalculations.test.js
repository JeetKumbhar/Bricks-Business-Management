// Tests for the daily maap calculations and the Maapvali / Patlavale day saves. Run with: npx vitest run
// Rule: the rate is set per 4 maaps (= 1,000 payable bricks) but EVERY maap is paid in proportion. No floor, no carry-forward.
import { describe, expect, it } from "vitest";
import { upsertProductionDay } from "../features/production/productionEntryOps";
import { buildProductionDailyRows, getDailyTeamRoster, summarizeProductionDay } from "../features/production/productionSelectors";
import { upsertMaapDay } from "../features/work/maapvali/maapEntryOps";
import { buildMaapDailyRows, getDailyRoster, summarizeMaapDay } from "../features/work/maapvali/maapSelectors";
import { buildAccount } from "./accountCalculations";
import {
  deriveMaapEntries,
  deriveProductionEntries,
  earningsForMaaps,
  getMaapvaliCalculation,
  getPatlavaleCalculation,
  parseDailyMaaps,
} from "./dailyWorkCalculations";
import { initialMaapEntries } from "../mock/maapEntries";
import { initialProductionEntries } from "../mock/production";
import { maapvaliRecords, patlavaleRecords } from "../mock/labours";
import { validateMocks } from "../mock/validateMocks";

describe("Maapvali earnings = maaps / 4 x rate per 4 maaps (every maap is paid)", () => {
  it.each([
    [40, 2500],
    [41, 2562.5],
    [5, 312.5],
    [1, 62.5],
    [0, 0],
    [3, 187.5],
    [4, 250],
  ])("%i maaps at 250 per 4 maaps = %f", (maaps, expected) => {
    expect(getMaapvaliCalculation({ maapsEntered: maaps, ratePerFourMaaps: 250 }).earnings).toBe(expected);
  });
  it("the leftover maap is paid on top of the 40: 41 maaps earns more than 40", () => {
    expect(earningsForMaaps(41, 250) - earningsForMaaps(40, 250)).toBe(62.5);
  });
  it("rejects negative, fractional and invalid values", () => {
    expect(() => getMaapvaliCalculation({ maapsEntered: -1, ratePerFourMaaps: 250 })).toThrow();
    expect(() => getMaapvaliCalculation({ maapsEntered: 1.5, ratePerFourMaaps: 250 })).toThrow();
    expect(() => getMaapvaliCalculation({ maapsEntered: 4, ratePerFourMaaps: NaN })).toThrow();
  });
  it("splitting the work over days never changes the total (no carry, no loss)", () => {
    const days = [5, 6, 1, 3, 2];
    const split = days.reduce((t, m) => t + earningsForMaaps(m, 250), 0);
    expect(split).toBe(earningsForMaaps(days.reduce((a, b) => a + b, 0), 250));
  });
});

describe("Patlavale payable bricks = maaps x 250 (4 maaps = 1,000)", () => {
  it.each([
    [4, 1000],
    [5, 1250],
    [3, 750],
    [7, 1750],
    [0, 0],
  ])("%i maaps = %i payable bricks", (maaps, bricks) => {
    expect(getPatlavaleCalculation({ maapsEntered: maaps, ratePerFourMaaps: 650 }).payableBricks).toBe(bricks);
  });
  it("physical bricks are 275 per maap (4 maaps = 1,100), kept separately from payable", () => {
    expect(getPatlavaleCalculation({ maapsEntered: 4, ratePerFourMaaps: 650 })).toMatchObject({ physicalBricks: 1100, payableBricks: 1000 });
    expect(getPatlavaleCalculation({ maapsEntered: 5, ratePerFourMaaps: 650 })).toMatchObject({ physicalBricks: 1375, payableBricks: 1250 });
  });
  it("earnings are proportional: 5 maaps at 650 per 4 maaps = 812.50", () => {
    expect(getPatlavaleCalculation({ maapsEntered: 5, ratePerFourMaaps: 650 }).earnings).toBe(812.5);
  });
});

describe("parseDailyMaaps", () => {
  it("blank is not entered, zero is an explicit zero", () => {
    expect(parseDailyMaaps("")).toEqual({ status: "blank" });
    expect(parseDailyMaaps("  ")).toEqual({ status: "blank" });
    expect(parseDailyMaaps("0")).toEqual({ status: "ok", value: 0 });
    expect(parseDailyMaaps("41")).toEqual({ status: "ok", value: 41 });
  });
  it("rejects negative, fractional, text and huge numbers", () => {
    ["-1", "2.5", "abc", "10000"].forEach((t) => expect(parseDailyMaaps(t).status).toBe("error"));
  });
});

const worker = { id: "L-049", labourType: "MAAPVALI", name: "Test", ratePerFourMaaps: 250, status: "ACTIVE", joiningDate: "2026-01-01" };
const mday = (date, maaps, id) => ({ id, labourId: "L-049", seasonId: "s", date, numberOfMaaps: maaps, ratePerFourMaaps: 250, note: "", isDeleted: false });

describe("upsertMaapDay", () => {
  const start = deriveMaapEntries([mday("2026-03-01", 41, "a"), mday("2026-03-03", 5, "c")]);
  const run = (entries, date, maaps, reason) => upsertMaapDay({ allEntries: entries, date, rows: [{ worker, maaps }], reason, seasonId: "s" });

  it("derived entries pay every maap", () => {
    expect(start.map((e) => e.earnings)).toEqual([2562.5, 312.5]);
  });
  it("creates one record, then updates it instead of duplicating", () => {
    const first = run(start, "2026-03-05", 4);
    const second = run(first.entries, "2026-03-05", 9, "fix");
    const onDay = second.entries.filter((e) => e.date === "2026-03-05");
    expect(onDay).toHaveLength(1);
    expect(onDay[0]).toMatchObject({ numberOfMaaps: 9, earnings: 562.5, editedReason: "fix" });
  });
  it("saving unchanged values changes nothing", () => {
    expect(run(start, "2026-03-03", 5).changedIds).toEqual([]);
  });
  it("editing an earlier date leaves every other date untouched (no carry-forward)", () => {
    const edited = run(start, "2026-03-01", 40, "typo").entries;
    expect(edited.find((e) => e.date === "2026-03-01").earnings).toBe(2500);
    expect(edited.find((e) => e.date === "2026-03-03")).toEqual(start.find((e) => e.date === "2026-03-03"));
  });
  it("zero is recorded as an explicit entry; a back-dated reason is kept as the audit trail", () => {
    const r = run(start, "2026-03-05", 0, "forgot to enter");
    expect(r.entries.find((e) => e.date === "2026-03-05")).toMatchObject({ numberOfMaaps: 0, earnings: 0, backdatedReason: "forgot to enter" });
  });
});

describe("daily rows and summary (Maapvali)", () => {
  const entries = deriveMaapEntries([mday("2026-03-01", 3, "a")]);
  const w2 = { ...worker, id: "L-050", name: "Other" };
  it("lists every active worker once; inactive hidden; blank vs zero distinct; 41 maaps = 2,562.50", () => {
    const roster = getDailyRoster([worker, w2, { ...worker, id: "L-053", status: "INACTIVE" }], "2026-03-02");
    expect(roster.map((w) => w.id)).toEqual(["L-049", "L-050"]);
    const rows = buildMaapDailyRows({ roster, entries, date: "2026-03-02", draft: { "L-049": { maaps: "41" }, "L-050": { maaps: "0" } } });
    expect(rows[0].calc.earnings).toBe(2562.5);
    expect(rows[1]).toMatchObject({ entered: true, calc: { earnings: 0 } });
    expect(summarizeMaapDay(rows)).toMatchObject({ entered: 2, maaps: 41, earnings: 2562.5 });
    const blank = buildMaapDailyRows({ roster, entries, date: "2026-03-02", draft: {} });
    expect(blank.every((r) => !r.entered && r.calc === null)).toBe(true);
  });
  it("a saved row cannot be blanked", () => {
    const rows = buildMaapDailyRows({ roster: [worker], entries, date: "2026-03-01", draft: { "L-049": { maaps: "" } } });
    expect(rows[0].error).toMatch(/Enter 0/);
  });
});

const team = { id: "L-055", labourType: "PATLAVALE", name: "Team A", ratePer1000PayableBricks: 650, status: "ACTIVE", joiningDate: "2026-01-01" };
const pday = (date, maaps, id) => ({ id, teamId: "L-055", seasonId: "s", date, newMaaps: maaps, ratePer1000PayableBricks: 650, note: "", isDeleted: false });

describe("Patlavale entries and day save", () => {
  const start = deriveProductionEntries([pday("2026-03-01", 5, "a"), pday("2026-03-03", 3, "c")]);
  const run = (entries, date, maaps, reason) => upsertProductionDay({ allEntries: entries, date, rows: [{ team, maaps }], reason, seasonId: "s" });

  it("5 maaps = 1,250 payable bricks and the leftover maap is paid", () => {
    expect(start[0]).toMatchObject({ newMaaps: 5, newPhysicalBricks: 1375, newPayableBricks: 1250, newEarnings: 812.5 });
    expect(start[1]).toMatchObject({ newPayableBricks: 750, newEarnings: 487.5 });
  });
  it("one record per team and date; saving again updates; other dates unchanged", () => {
    const first = run(start, "2026-03-05", 4);
    const second = run(first.entries, "2026-03-05", 9, "fix");
    expect(second.entries.filter((e) => e.date === "2026-03-05")).toHaveLength(1);
    expect(second.entries.find((e) => e.date === "2026-03-05")).toMatchObject({ newMaaps: 9, newPayableBricks: 2250, editedReason: "fix" });
    expect(second.entries.find((e) => e.date === "2026-03-01")).toEqual(start[0]);
  });
  it("payments never change production", () => {
    const none = buildAccount({ labourType: "PATLAVALE", productionEntries: start, payments: [] });
    const paid = buildAccount({
      labourType: "PATLAVALE",
      productionEntries: start,
      payments: [{ id: "p", labourId: "L-055", recipientId: "L-055", date: "2026-03-02", type: "SALARY_PAYMENT", amount: 500, isDeleted: false }],
    });
    expect([paid.totalMaaps, paid.totalPayableBricks, paid.earned]).toEqual([none.totalMaaps, none.totalPayableBricks, none.earned]);
  });
  it("rows: every active team once, inactive hidden, search-independent calculations", () => {
    const roster = getDailyTeamRoster([team, { ...team, id: "L-057", name: "B" }, { ...team, id: "L-056", status: "INACTIVE" }], "2026-03-02");
    expect(roster.map((t) => t.id)).toEqual(["L-055", "L-057"]);
    const rows = buildProductionDailyRows({ roster, entries: start, date: "2026-03-02", draft: { "L-055": { maaps: "7" }, "L-057": { maaps: "0" } } });
    expect(rows[0].calc).toMatchObject({ payableBricks: 1750, earnings: 1137.5 });
    expect(summarizeProductionDay(rows)).toMatchObject({ entered: 2, maaps: 7, payableBricks: 1750 });
  });
});

describe("mock data", () => {
  it("passes the schema checks, with 3+ dates per Maapvali worker and Patlavale team", () => {
    const result = validateMocks();
    expect(result.errors).toEqual([]);
    maapvaliRecords.forEach((w) => expect(initialMaapEntries.filter((e) => e.labourId === w.id).length).toBeGreaterThanOrEqual(3));
    patlavaleRecords.forEach((t) => expect(initialProductionEntries.filter((e) => e.teamId === t.id).length).toBeGreaterThanOrEqual(3));
  });
  it("every recorded maap is paid: each worker's total earnings = all maaps / 4 x rate (nothing deducted for leftovers)", () => {
    maapvaliRecords.forEach((w) => {
      const list = initialMaapEntries.filter((e) => e.labourId === w.id);
      const totalMaaps = list.reduce((t, e) => t + e.numberOfMaaps, 0);
      expect(list.reduce((t, e) => t + e.earnings, 0)).toBeCloseTo((totalMaaps / 4) * w.ratePerFourMaaps, 2);
    });
  });
  it("L-049 earnings include every maap: the 41st maap is paid, not just 40", () => {
    const w = maapvaliRecords.find((r) => r.id === "L-049");
    const list = initialMaapEntries.filter((e) => e.labourId === w.id);
    const totalMaaps = list.reduce((t, e) => t + e.numberOfMaaps, 0);
    const earned = list.reduce((t, e) => t + e.earnings, 0);
    expect(totalMaaps % 4).not.toBe(0); // the mock data really does contain leftover maaps
    expect(earned).toBe(Math.round((totalMaaps / 4) * w.ratePerFourMaaps * 100) / 100);
    expect(earned).toBeGreaterThan(Math.floor(totalMaaps / 4) * w.ratePerFourMaaps);
    // 41 maaps on one day at L-049's rate of 88 per 4 maaps: 902 (the old floor rule gave 880)
    expect(getMaapvaliCalculation({ maapsEntered: 41, ratePerFourMaaps: w.ratePerFourMaaps }).earnings).toBe(902);
  });
  it("payments never change maaps or earnings", () => {
    const entries = deriveMaapEntries([mday("2026-03-01", 41, "a")]);
    const none = buildAccount({ labourType: "MAAPVALI", maapEntries: entries, payments: [] });
    const paid = buildAccount({
      labourType: "MAAPVALI",
      maapEntries: entries,
      payments: [{ id: "p", labourId: "L-049", recipientId: "L-049", date: "2026-03-02", type: "SALARY_PAYMENT", amount: 100, isDeleted: false }],
    });
    expect([paid.totalMaaps, paid.earned]).toEqual([none.totalMaaps, none.earned]);
    expect(none.earned).toBe(2562.5);
  });
});
