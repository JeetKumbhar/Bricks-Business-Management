import { describe, expect, it } from "vitest";
import { changedCount, removeById, replaceDay, replaceForLabour, upsertById } from "./labourDataOps";

describe("labourDataOps", () => {
  it("upsertById inserts new and replaces existing without mutating", () => {
    const list = [{ id: "a", v: 1 }];
    const added = upsertById(list, { id: "b", v: 2 });
    expect(added.length).toBe(2);
    expect(list.length).toBe(1);
    expect(upsertById(added, { id: "a", v: 9 })[0].v).toBe(9);
  });

  it("removeById", () => {
    expect(removeById([{ id: "a" }, { id: "b" }], "a")).toEqual([{ id: "b" }]);
  });

  it("replaceDay swaps one date for the server's list and leaves other days alone", () => {
    const list = [{ id: "1", date: "2026-11-01" }, { id: "2", date: "2026-11-02" }];
    const out = replaceDay(list, "2026-11-02", [{ id: "3", date: "2026-11-02" }, { id: "4", date: "2026-11-02" }]);
    expect(out.map((x) => x.id).sort()).toEqual(["1", "3", "4"]);
    expect(replaceDay(list, "2026-11-02", []).map((x) => x.id)).toEqual(["1"]);
  });

  it("replaceForLabour", () => {
    const out = replaceForLabour([{ id: "r1", labourId: "L-1" }, { id: "r2", labourId: "L-2" }], "L-1", [{ id: "r9", labourId: "L-1" }]);
    expect(out.map((x) => x.id).sort()).toEqual(["r2", "r9"]);
  });

  it("changedCount counts created and corrected records, not unchanged ones", () => {
    expect(changedCount({ created: 2, updated: 1, unchanged: 5 })).toBe(3);
    expect(changedCount(undefined)).toBe(0);
  });
});
