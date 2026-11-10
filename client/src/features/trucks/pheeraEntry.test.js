// Unit tests (no network): what the entry screen turns into the request payload.
import { describe, expect, it } from "vitest";
import { createPheeraBatch } from "../../services/pheeraApi";
import { call, ok, stubFetch } from "../../services/_mockHelpers";
import { customerOptionsFor, INTERNAL_LABEL, splitCustomers } from "../customers/customerChoices";
import { prepareEntry } from "./pheeraEntry";
import { afterEach, vi } from "vitest";

afterEach(() => vi.unstubAllGlobals());

const trucks = [{ id: "t1", truckNumber: "MH12AB1234" }];
const base = { businessDate: "2026-11-01", truckId: "t1", today: "2026-11-02", trucks };
const row = (o = {}) => ({ key: "k1", customerId: "c1", material: "Bricks", customMaterial: "", destination: "Pune", quantity: "1500", remarks: "", ...o });

describe("prepareEntry", () => {
  it("8. builds the payload: real truck id, date, customer, material name, numeric quantity, stable clientRowIds; NO pheera number, unit or truck number", () => {
    const { check, payload } = prepareEntry({ ...base, drafts: [row(), row({ key: "k2", material: "Sand", quantity: "7.5" })] });
    expect(check.valid).toBe(true);
    expect(payload).toMatchObject({ businessDate: "2026-11-01", truckId: "t1" });
    expect(payload.rows.map((r) => r.clientRowId)).toEqual(["row-k1", "row-k2"]);
    expect(payload.rows[0]).toMatchObject({ customerId: "c1", material: "Bricks", quantity: 1500, destination: "Pune" });
    expect(typeof payload.rows[0].quantity).toBe("number");
    expect(payload.rows[1].quantity).toBe(7.5);
  });

  it("11. rebuilding the payload keeps the SAME clientRowId for the same row", () => {
    const drafts = [row()];
    expect(prepareEntry({ ...base, drafts }).payload.rows[0].clientRowId).toBe(prepareEntry({ ...base, drafts }).payload.rows[0].clientRowId);
  });

  it("9. bricks must be whole numbers; tonnes allow 2 decimals; unit comes from the material", () => {
    expect(prepareEntry({ ...base, drafts: [row({ quantity: "1500.5" })] }).check.rowErrors[0].quantity).toMatch(/whole number/);
    expect(prepareEntry({ ...base, drafts: [row({ material: "Soil", quantity: "4.555" })] }).check.rowErrors[0].quantity).toMatch(/decimal/);
    const ok2 = prepareEntry({ ...base, drafts: [row({ material: "Soil", quantity: "4.55" })] });
    expect(ok2.check.valid).toBe(true);
    expect(ok2.payload.rows[0].quantity).toBe(4.55);
    expect(prepareEntry({ ...base, drafts: [row({ quantity: "0" })] }).check.valid).toBe(false);
  });

  it("9b. 'Other' needs the real material name; a name spelled like a known one uses the known spelling", () => {
    expect(prepareEntry({ ...base, drafts: [row({ material: "Other", customMaterial: "" })] }).check.rowErrors[0].customMaterial).toBeTruthy();
    const { payload } = prepareEntry({ ...base, drafts: [row({ material: "Other", customMaterial: "  stone   dust ", quantity: "3" })], customNames: ["Stone Dust"] });
    expect(payload.rows[0].material).toBe("Stone Dust");
  });

  it("10. a customer is required for every row; no payload is made without one", () => {
    const out = prepareEntry({ ...base, drafts: [row(), row({ key: "k2", customerId: "" })] });
    expect(out.check.valid).toBe(false);
    expect(out.check.rowErrors[1].customerId).toMatch(/customer/i);
    expect(out.payload).toBeNull();
  });

  it("a future date or no truck is refused before any request", () => {
    expect(prepareEntry({ ...base, businessDate: "2026-12-01", drafts: [row()] }).payload).toBeNull();
    expect(prepareEntry({ ...base, truckId: "", drafts: [row()] }).payload).toBeNull();
  });

  it("9c. the payload sent over the wire has the server's material fields and no server-owned fields", async () => {
    const fetchMock = stubFetch();
    fetchMock.mockResolvedValueOnce(ok([{ id: "p1" }], { duplicate: false }, 201));
    const { payload } = prepareEntry({ ...base, drafts: [row(), row({ key: "k2", material: "Sand", quantity: "7.5" }), row({ key: "k3", material: "Soil", quantity: "2" })] });
    await createPheeraBatch({ ...payload, submissionId: "sub-12345678" });
    const { body } = call(fetchMock);
    expect(body.submissionId).toBe("sub-12345678");
    expect(body.trips.map((t) => [t.material, t.customMaterialName])).toEqual([["BRICKS", undefined], ["OTHER", "Sand"], ["SOIL", undefined]]);
    expect(JSON.stringify(body)).not.toMatch(/pheeraNo|pheeraNumber|"unit"|truckRegistration|truckNumber|batchId/);
  });
});

describe("customer choices (Internal / No Bill behaviour)", () => {
  const all = [
    { id: "c2", name: "Zed", isInternal: false, isArchived: false },
    { id: "c1", name: "Ram", isInternal: false, isArchived: false },
    { id: "c3", name: "Old", isInternal: false, isArchived: true },
    { id: "i1", name: "Internal / No Bill", isInternal: true, isArchived: false, kind: "INTERNAL" },
  ];
  it("10. normal customers are active ones only, A-Z; Internal is never in that list and archived ones are never offered", () => {
    const { customers, internal } = splitCustomers(all);
    expect(customers.map((c) => c.id)).toEqual(["c1", "c2"]);
    expect(internal.id).toBe("i1");
  });
  it("10b. Internal is its own labelled option; without it only normal customers are offered", () => {
    expect(customerOptionsFor(splitCustomers(all)).map((o) => o.label)).toEqual(["Ram", "Zed", INTERNAL_LABEL]);
    expect(customerOptionsFor(splitCustomers(all.slice(0, 3))).map((o) => o.value)).toEqual(["c1", "c2"]);
    expect(splitCustomers(all.slice(0, 3)).internal).toBeNull();
  });
  it("an archived Internal customer is not offered", () => {
    expect(splitCustomers([{ ...all[3], isArchived: true }]).internal).toBeNull();
  });
});
