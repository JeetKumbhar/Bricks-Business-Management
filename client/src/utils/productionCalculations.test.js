// Tests for the Patlavale season totals and the "payments never change production" rule. Run with: npx vitest run
import { describe, expect, it } from "vitest";
import { buildPatlavaleStats } from "../features/labours/labourStats";
import { deriveProductionEntries } from "./dailyWorkCalculations";
import { summarizeProduction } from "./productionCalculations";

const RATE = 250; // illustrative rate per 4 maaps (= 1,000 payable bricks)
const day = (date, newMaaps, id) => ({ id, teamId: "L-055", date, newMaaps, ratePer1000PayableBricks: RATE, isDeleted: false });

describe("summarizeProduction", () => {
  it("adds maaps, physical bricks, payable bricks and earnings; every maap counts", () => {
    const ledger = deriveProductionEntries([day("2026-10-01", 5, "a"), day("2026-10-02", 3, "b")]);
    expect(summarizeProduction(ledger)).toEqual({ totalMaaps: 8, totalPhysicalBricks: 2200, totalPayableBricks: 2000, totalEarnings: 500 });
  });
  it("an empty ledger is all zero", () => {
    expect(summarizeProduction([])).toEqual({ totalMaaps: 0, totalPhysicalBricks: 0, totalPayableBricks: 0, totalEarnings: 0 });
  });
});

describe("payments never change production", () => {
  const team = { id: "L-055", labourType: "PATLAVALE", name: "Test Family", ratePer1000PayableBricks: RATE };
  const ledger = deriveProductionEntries([day("2026-10-01", 5, "a"), day("2026-10-02", 3, "b")]);

  it("production totals stay the same, only the balance moves", () => {
    const noPayments = buildPatlavaleStats(team, ledger, []);
    const afterPayment = buildPatlavaleStats(team, ledger, [
      { id: "p1", labourId: "L-055", type: "SALARY_PAYMENT", amount: 300, date: "2026-10-03", isDeleted: false },
    ]);
    for (const key of ["totalMaaps", "totalPhysicalBricks", "totalPayableBricks", "earned", "productionDays"]) {
      expect(afterPayment[key]).toBe(noPayments[key]);
    }
    expect(noPayments.balance).toBe(500);
    expect(afterPayment.balance).toBe(200);
  });
});
