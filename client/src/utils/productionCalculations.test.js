// Tests for the Patlavale production maths. Run with Vitest:
//   npm install -D vitest
//   npx vitest run
import { describe, expect, it } from "vitest";
import { buildPatlavaleStats } from "../features/labours/labourStats";
import {
  calculateProductionEntry,
  previewLedgerEntry,
  recalculateLedger,
  summarizeProduction,
  validatePhysicalBricks,
} from "./productionCalculations";

const RATE = 250; // illustrative rate per 1,000 payable bricks

const entry = (newPhysicalBricks, previousCarryBricks) =>
  calculateProductionEntry({ newPhysicalBricks, previousCarryBricks, ratePer1000PayableBricks: RATE });

describe("calculateProductionEntry (confirmed 1,100-to-1,000 rule)", () => {
  it("1500 + 0 = 1500 -> 1 group, 1,000 payable, 400 carry", () => {
    expect(entry(1500, 0)).toMatchObject({ physicalAvailable: 1500, completedGroups: 1, newPayableBricks: 1000, carryForwardBricks: 400 });
  });

  it("800 + 400 = 1200 -> 1 group, 1,000 payable, 100 carry", () => {
    expect(entry(800, 400)).toMatchObject({ physicalAvailable: 1200, completedGroups: 1, newPayableBricks: 1000, carryForwardBricks: 100 });
  });

  it("1000 + 100 = 1100 -> 1 group, 1,000 payable, 0 carry", () => {
    expect(entry(1000, 100)).toMatchObject({ physicalAvailable: 1100, completedGroups: 1, newPayableBricks: 1000, carryForwardBricks: 0 });
  });

  it("900 + 100 = 1000 -> 0 groups, 0 payable, 1,000 carry", () => {
    expect(entry(900, 100)).toMatchObject({ physicalAvailable: 1000, completedGroups: 0, newPayableBricks: 0, carryForwardBricks: 1000, newEarnings: 0 });
  });

  it("several groups in one entry: 3,000 -> 2 groups, 2,000 payable, 800 carry", () => {
    expect(entry(3000, 0)).toMatchObject({ completedGroups: 2, newPayableBricks: 2000, carryForwardBricks: 800 });
  });

  it("earnings = payable / 1000 x the team's rate", () => {
    expect(entry(1500, 0).newEarnings).toBe(250);
    expect(calculateProductionEntry({ newPhysicalBricks: 2300, previousCarryBricks: 0, ratePer1000PayableBricks: 650 }).newEarnings).toBe(1300);
  });

  it("rejects fractional and negative inputs", () => {
    expect(() => entry(10.5, 0)).toThrow(RangeError);
    expect(() => entry(-1, 0)).toThrow(RangeError);
    expect(() => entry(100, -5)).toThrow(RangeError);
  });
});

describe("ledger across several days", () => {
  const day = (date, newPhysicalBricks, createdAt) => ({
    id: `e-${date}`,
    teamId: "L-055",
    date,
    newPhysicalBricks,
    ratePer1000PayableBricks: RATE,
    createdAt,
  });

  it("carries the remainder forward: 1500, 800, 1000", () => {
    const ledger = recalculateLedger([day("2026-10-01", 1500), day("2026-10-02", 800), day("2026-10-03", 1000)]);
    expect(ledger.map((e) => e.carryForwardBricks)).toEqual([400, 100, 0]);
    expect(ledger.map((e) => e.newPayableBricks)).toEqual([1000, 1000, 1000]);
    expect(summarizeProduction(ledger)).toMatchObject({ totalPhysicalBricks: 3300, totalPayableBricks: 3000, carryForwardBricks: 0, totalEarnings: 750 });
  });

  it("a back-dated entry re-chains the later days", () => {
    const before = [day("2026-10-01", 1500), day("2026-10-03", 800)];
    const { entry: added, season, laterEntriesChanged } = previewLedgerEntry(before, {
      date: "2026-10-02",
      newPhysicalBricks: 700,
      ratePer1000PayableBricks: RATE,
    });
    expect(added).toMatchObject({ previousCarryBricks: 400, physicalAvailable: 1100, newPayableBricks: 1000, carryForwardBricks: 0 });
    expect(laterEntriesChanged).toBe(1); // the 3rd Oct entry now starts from a carry of 0
    // 3,000 physical bricks in total = 2 full groups of 1,100 + 800 left over
    expect(season).toMatchObject({ totalPhysicalBricks: 3000, totalPayableBricks: 2000, carryForwardBricks: 800 });
  });

  it("a deleted entry is skipped and the carry is recalculated", () => {
    const entries = [day("2026-10-01", 1500), { ...day("2026-10-02", 800), isDeleted: true }, day("2026-10-03", 1000)];
    const ledger = recalculateLedger(entries);
    expect(ledger).toHaveLength(2);
    expect(ledger[1]).toMatchObject({ previousCarryBricks: 400, physicalAvailable: 1400, carryForwardBricks: 300 });
  });
});

describe("payments never change production", () => {
  const team = { id: "L-055", labourType: "PATLAVALE", name: "Test Family", ratePer1000PayableBricks: RATE };
  const ledger = recalculateLedger([
    { id: "a", teamId: "L-055", date: "2026-10-01", newPhysicalBricks: 1500, ratePer1000PayableBricks: RATE },
    { id: "b", teamId: "L-055", date: "2026-10-02", newPhysicalBricks: 800, ratePer1000PayableBricks: RATE },
  ]);

  it("production totals and carry stay the same, only the balance moves", () => {
    const noPayments = buildPatlavaleStats(team, ledger, []);
    const afterPayment = buildPatlavaleStats(team, ledger, [
      { id: "p1", labourId: "L-055", type: "SALARY_PAYMENT", amount: 300, date: "2026-10-03", isDeleted: false },
    ]);

    for (const key of ["totalPhysicalBricks", "totalPayableBricks", "carryForwardBricks", "earned", "productionDays"]) {
      expect(afterPayment[key]).toBe(noPayments[key]);
    }
    expect(noPayments.balance).toBe(500);
    expect(afterPayment.balance).toBe(200);
    expect(afterPayment.carryForwardBricks).toBe(100);
  });
});

describe("validatePhysicalBricks", () => {
  it("accepts whole bricks of 1 or more", () => {
    expect(validatePhysicalBricks("1500")).toBeNull();
  });
  it("rejects empty, negative, zero, fractional and non-numeric", () => {
    expect(validatePhysicalBricks("")).toMatch(/Enter/);
    expect(validatePhysicalBricks("-5")).toMatch(/negative/);
    expect(validatePhysicalBricks("0")).toMatch(/at least 1/);
    expect(validatePhysicalBricks("12.5")).toMatch(/whole/);
    expect(validatePhysicalBricks("abc")).toMatch(/valid/);
  });
});
