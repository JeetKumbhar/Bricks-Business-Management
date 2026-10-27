// Tests for the account calculation layer. Run with Vitest:
//   npm install -D vitest
//   npx vitest run
import { describe, expect, it } from "vitest";
import { buildWorkerStats, enrichAttendance } from "../features/labours/labourStats";
import {
  ACCOUNTING_POLICY,
  buildAccount,
  countsAsReceived,
  summarizeTransactions,
} from "./accountCalculations";
import { deriveProductionEntries } from "./dailyWorkCalculations";

const pay = (type, amount, extra = {}) => ({ id: `${type}-${amount}`, labourId: "L-001", type, amount, date: "2026-10-05", isDeleted: false, ...extra });

describe("earnings come from each type's own records", () => {
  it("Bigari: attendance x the rate in force that day", () => {
    const rates = [
      { effectiveFrom: "2026-10-01", rate: 700 },
      { effectiveFrom: "2026-10-03", rate: 750 },
    ];
    const attendance = enrichAttendance(
      [
        { id: "a1", date: "2026-10-01", status: "PRESENT" },
        { id: "a2", date: "2026-10-02", status: "HALF_DAY" },
        { id: "a3", date: "2026-10-03", status: "PRESENT" },
        { id: "a4", date: "2026-10-04", status: "ABSENT" },
      ],
      rates
    );
    // 700 + 350 + 750 + 0
    expect(buildAccount({ labourType: "BIGARI", attendance, payments: [] })).toMatchObject({ earned: 1800, workingUnits: 2.5 });
  });

  it("Maapvali: maaps / 4 x that worker's rate (no attendance, no brick conversion)", () => {
    const maapEntries = [
      { numberOfMaaps: 30, earnings: 660 },
      { numberOfMaaps: 20, earnings: 440 },
    ];
    expect(buildAccount({ labourType: "MAAPVALI", maapEntries, payments: [] })).toMatchObject({ earned: 1100, totalMaaps: 50, workDays: 2 });
  });

  it("Patlavale: every maap pays (5 maaps then 3 maaps at 250 per 4 maaps)", () => {
    const productionEntries = deriveProductionEntries([
      { id: "p1", date: "2026-10-01", newMaaps: 5, ratePer1000PayableBricks: 250 },
      { id: "p2", date: "2026-10-02", newMaaps: 3, ratePer1000PayableBricks: 250 },
    ]);
    expect(buildAccount({ labourType: "PATLAVALE", productionEntries, payments: [] })).toMatchObject({
      earned: 500, // 8 maaps / 4 x 250
      totalMaaps: 8,
      totalPhysicalBricks: 2200,
      totalPayableBricks: 2000,
    });
  });

  it("attendance given to a Maapvali or a Patlavale team creates no earnings", () => {
    const stray = [{ earned: 999, units: 1 }];
    expect(buildAccount({ labourType: "MAAPVALI", attendance: stray, maapEntries: [], payments: [] }).earned).toBe(0);
    expect(buildAccount({ labourType: "PATLAVALE", attendance: stray, productionEntries: [], payments: [] }).earned).toBe(0);
  });
});

describe("received transactions: each counted once, no double deduction", () => {
  const payments = [pay("BOOKING_ADVANCE", 3000), pay("SALARY_PAYMENT", 2000), pay("OTHER", 500)];

  it("Bayana is part of total received and is NOT subtracted again", () => {
    const account = buildAccount({ labourType: "MAAPVALI", maapEntries: [{ numberOfMaaps: 1, earnings: 10000 }], payments });
    expect(account).toMatchObject({ bookingAdvance: 3000, salaryPayments: 2000, otherPayments: 500, totalReceived: 5500 });
    expect(account.balance).toBe(4500); // 10,000 - 5,500. A double deduction would give 1,500.
  });

  it("deleted payments are ignored", () => {
    const withDeleted = [...payments, pay("SALARY_PAYMENT", 9999, { id: "gone", isDeleted: true })];
    expect(summarizeTransactions(withDeleted).totalReceived).toBe(5500);
  });

  it("the policy is the single switch for the open accounting questions", () => {
    expect(countsAsReceived("BOOKING_ADVANCE")).toBe(ACCOUNTING_POLICY.bayanaCountsAsReceived);
    const strict = { bayanaCountsAsReceived: false, otherCountsAsReceived: false };
    expect(summarizeTransactions(payments, strict)).toMatchObject({ totalReceived: 2000, notCounted: 3500 });
  });
});

describe("payments never change work or production", () => {
  const maapEntries = [{ id: "m1", labourId: "L-049", date: "2026-10-01", numberOfMaaps: 30, earnings: 660 }];
  const ledger = deriveProductionEntries([{ id: "p1", date: "2026-10-01", newMaaps: 5, ratePer1000PayableBricks: 250 }]);

  it("Maapvali: maap counts and earnings stay, only the balance moves", () => {
    const worker = { id: "L-049", labourType: "MAAPVALI" };
    const before = buildWorkerStats(worker, { maap: maapEntries, payments: [] });
    const after = buildWorkerStats(worker, { maap: maapEntries, payments: [pay("BOOKING_ADVANCE", 200)] });
    expect([after.totalMaaps, after.workDays, after.earned]).toEqual([before.totalMaaps, before.workDays, before.earned]);
    expect(before.balance - after.balance).toBe(200);
  });

  it("Patlavale: maaps, production and payable bricks stay, only the balance moves", () => {
    const team = { id: "L-055", labourType: "PATLAVALE" };
    const before = buildWorkerStats(team, { production: ledger, payments: [] });
    const after = buildWorkerStats(team, { production: ledger, payments: [pay("SALARY_PAYMENT", 100)] });
    expect([after.totalMaaps, after.totalPhysicalBricks, after.totalPayableBricks, after.earned]).toEqual([
      before.totalMaaps,
      before.totalPhysicalBricks,
      before.totalPayableBricks,
      before.earned,
    ]);
    expect(before.balance - after.balance).toBe(100);
  });
});
