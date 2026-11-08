import { describe, expect, it } from "vitest";
import { reconcileBalances } from "./reconcile";

const row = (id, earned, received, balance, name = `Name ${id}`) => ({ id, name, season: { earned, received, balance } });
const app = (id, earned, totalReceived, balance, name = `Name ${id}`) => ({ id, name, earned, totalReceived, balance });

describe("reconcileBalances", () => {
  it("everything matches", () => {
    const r = reconcileBalances([row("L-001", 2000, 500, 1500), row("L-002", 300, 0, 300)], [app("L-001", 2000, 500, 1500), app("L-002", 300, 0, 300)]);
    expect(r).toEqual({ checked: 2, matching: 2, differences: [] });
  });

  it("differences under the rounding tolerance are ignored", () => {
    const r = reconcileBalances([row("L-001", 2000.004, 500, 1500.004)], [app("L-001", 2000, 500, 1500)]);
    expect(r.differences).toEqual([]);
  });

  it("reports each figure that differs, with both values", () => {
    const r = reconcileBalances([row("L-001", 2000, 500, 1500)], [app("L-001", 2000, 400, 1600)]);
    expect(r.matching).toBe(0);
    expect(r.differences).toEqual([
      { id: "L-001", name: "Name L-001", field: "received", server: 500, app: 400 },
      { id: "L-001", name: "Name L-001", field: "balance", server: 1500, app: 1600 },
    ]);
  });

  it("a labour the server lists but the app does not have is a difference", () => {
    const r = reconcileBalances([row("L-009", 100, 0, 100)], []);
    expect(r.differences[0].field).toBe("missing in the app");
  });

  it("a labour the server left out (inactive, nothing owed) but the app shows a balance for is a difference; a zero balance is fine", () => {
    const labours = [app("L-001", 100, 0, 100), app("L-002", 0, 0, 0)];
    const r = reconcileBalances([], labours);
    expect(r.differences.map((d) => d.id)).toEqual(["L-001"]);
  });

  it("an overpaid (negative) balance is compared like any other", () => {
    expect(reconcileBalances([row("L-001", 100, 300, -200)], [app("L-001", 100, 300, -200)]).differences).toEqual([]);
    expect(reconcileBalances([row("L-001", 100, 300, -200)], [app("L-001", 100, 300, 0)]).differences.length).toBe(1);
  });
});
