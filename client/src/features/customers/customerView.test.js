// Unit tests (no network): what the Customers screen shows and which buttons it offers.
import { describe, expect, it } from "vitest";
import { fromCustomerDto } from "../../services/customerApi";
import { canArchive, canEdit, canRestore, countByView, customerState, filterCustomers, validateArchiveReason } from "./customerView";

const c = (o) => fromCustomerDto({ id: o.name, kind: "NORMAL", isInternal: false, isArchived: false, revision: 1, ...o });
const items = [
  c({ name: "Zed Traders", contact: "9876543210", gstin: "27ABCDE1234F1Z5", stateName: "Maharashtra", address: "Pune road" }),
  c({ name: "Ram  Constructions", contact: "9000000001" }),
  c({ name: "Old Co", isArchived: true, archivedReason: "Closed" }),
  c({ name: "Internal / No Bill", kind: "INTERNAL", isInternal: true }),
];

describe("customer list view", () => {
  it("2. active view: built-in first, then A-Z; archived customers are not in it", () => {
    expect(filterCustomers(items, { view: "active" }).map((x) => x.name)).toEqual(["Internal / No Bill", "Ram  Constructions", "Zed Traders"]);
  });
  it("archived view: archived customers only (never the built-in one)", () => {
    expect(filterCustomers(items, { view: "archived" }).map((x) => x.name)).toEqual(["Old Co"]);
  });
  it("2. search ignores case and extra spaces and looks in name, contact, GSTIN, state and address", () => {
    const names = (q) => filterCustomers(items, { query: q }).map((x) => x.name);
    expect(names("ram constructions")).toEqual(["Ram  Constructions"]);
    expect(names("98765")).toEqual(["Zed Traders"]);
    expect(names("27abcde")).toEqual(["Zed Traders"]);
    expect(names("maharashtra")).toEqual(["Zed Traders"]);
    expect(names("pune")).toEqual(["Zed Traders"]);
    expect(names("nothing like this")).toEqual([]);
  });
  it("search applies inside the archived view too", () => {
    expect(filterCustomers(items, { query: "old", view: "archived" })).toHaveLength(1);
    expect(filterCustomers(items, { query: "zed", view: "archived" })).toHaveLength(0);
  });
  it("counts exclude the built-in customer", () => {
    expect(countByView(items)).toEqual({ active: 2, archived: 1 });
  });
  it("state labels", () => {
    expect(items.map(customerState)).toEqual(["active", "active", "archived", "internal"]);
  });
});

describe("what may be done (the server still decides)", () => {
  const [zed, , old, internal] = items;
  it("6/10. active customers can be edited and archived; archived ones can only be restored", () => {
    expect([canEdit(zed), canArchive(zed), canRestore(zed)]).toEqual([true, true, false]);
    expect([canEdit(old), canArchive(old), canRestore(old)]).toEqual([false, false, true]);
  });
  it("10. Internal / No Bill can never be edited, archived or restored", () => {
    expect([canEdit(internal), canArchive(internal), canRestore(internal)]).toEqual([false, false, false]);
    expect(canRestore({ ...internal, isArchived: true })).toBe(false);
  });
});

describe("6. archive needs a reason", () => {
  it("empty, blank and too-short reasons are refused; a real reason is accepted; 200 characters at most", () => {
    for (const r of ["", "   ", "ab", undefined]) expect(validateArchiveReason(r)).toMatch(/reason/i);
    expect(validateArchiveReason("Closed")).toBe("");
    expect(validateArchiveReason(" abc ")).toBe("");
    expect(validateArchiveReason("x".repeat(201))).toMatch(/too long/);
  });
});
