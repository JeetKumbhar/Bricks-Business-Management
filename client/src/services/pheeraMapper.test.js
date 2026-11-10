// MOCKED/unit tests: pure mapping, no network and no server.
import { describe, expect, it } from "vitest";
import { fromPheeraDto, materialFields, newSubmissionId, toBatchBody, toCorrectionBody, toListQuery, toSingleBody, toTripRow } from "./pheeraMapper";

const dto = (o = {}) => ({ id: "p1", truckId: "t1", truckNumber: "MH12AB1234", businessDate: "2026-11-01", pheeraNo: 2, materialCategory: "BRICKS", materialName: "Bricks", quantity: 1000, unit: "bricks", destination: "Pune", remarks: null, revision: 1, corrected: false, isVoided: false, voidReason: null, voidedAt: null, customer: { id: "c1", name: "Ram" }, billingStatus: "UNBILLED", billId: null, bill: null, submissionId: "sub-12345678", clientRowId: "row-1", ...o });

describe("fromPheeraDto (mapper unit tests)", () => {
  it("adds screen aliases and keeps the server names", () => {
    const r = fromPheeraDto(dto({ isVoided: true, voidReason: "Wrong", voidedAt: "2026-11-02" }));
    expect(r).toMatchObject({ pheeraNo: 2, pheeraNumber: 2, truckNumber: "MH12AB1234", truckRegistration: "MH12AB1234", material: "Bricks", materialName: "Bricks", isVoided: true, isDeleted: true, deletedReason: "Wrong", deletedAt: "2026-11-02", batchId: "sub-12345678", customerId: "c1", customerName: "Ram", remarks: "" });
  });
  it("historical record stays null: no customer or billing status is invented", () => {
    const r = fromPheeraDto(dto({ customer: null, billingStatus: null, submissionId: null }));
    expect(r).toMatchObject({ customer: null, customerId: null, customerName: null, billingStatus: null, billId: null, batchId: null, isDeleted: false });
  });
  it("passes billingHistory and audit through when present", () => {
    expect(fromPheeraDto(dto({ billingHistory: [{ a: 1 }], audit: [{ b: 2 }] }))).toMatchObject({ billingHistory: [{ a: 1 }], audit: [{ b: 2 }] });
  });
});

describe("materialFields", () => {
  it("Bricks and Soil are categories; every other name is OTHER with its real name", () => {
    expect(materialFields("Bricks")).toEqual({ material: "BRICKS" });
    expect(materialFields("Soil")).toEqual({ material: "SOIL" });
    expect(materialFields("Sand")).toEqual({ material: "OTHER", customMaterialName: "Sand" });
    expect(materialFields("  Hard   Murram ")).toEqual({ material: "OTHER", customMaterialName: "Hard Murram" });
  });
});

describe("request bodies", () => {
  const row = { customerId: "c1", material: "Sand", destination: " Pune ", quantity: "12.5", remarks: "" };
  it("a row sends a numeric quantity and never pheeraNo, unit or registration", () => {
    const r = toTripRow({ ...row, unit: "tonnes", pheeraNumber: 9, truckRegistration: "X" }, "row-1");
    expect(r).toEqual({ customerId: "c1", material: "OTHER", customMaterialName: "Sand", destination: "Pune", quantity: 12.5, remarks: "", clientRowId: "row-1" });
    expect(typeof r.quantity).toBe("number");
  });
  it("rejects a missing customer, a non-numeric quantity and a bad row id", () => {
    expect(() => toTripRow({ ...row, customerId: "" })).toThrow(/customer/i);
    expect(() => toTripRow({ ...row, quantity: "abc" })).toThrow(/number/);
    expect(() => toTripRow({ ...row, quantity: "" })).toThrow(/number/);
    expect(() => toTripRow(row, "bad id!")).toThrow();
  });
  it("batch body gives each row a clientRowId and keeps the submissionId", () => {
    const b = toBatchBody({ truckId: "t1", businessDate: "2026-11-01", submissionId: "sub-12345678", rows: [row, { ...row, material: "Bricks", clientRowId: "mine" }] });
    expect(b).toMatchObject({ truckId: "t1", businessDate: "2026-11-01", submissionId: "sub-12345678" });
    expect(b.trips.map((t) => t.clientRowId)).toEqual(["row-1", "mine"]);
    expect(b.trips[1].customMaterialName).toBeUndefined();
  });
  it("batch body refuses no truck, no rows and a malformed submissionId", () => {
    expect(() => toBatchBody({ truckId: "", businessDate: "d", rows: [row] })).toThrow();
    expect(() => toBatchBody({ truckId: "t1", businessDate: "d", rows: [] })).toThrow();
    expect(() => toBatchBody({ truckId: "t1", businessDate: "d", submissionId: "short", rows: [row] })).toThrow();
  });
  it("single body puts the row fields beside truckId and businessDate", () => {
    expect(toSingleBody({ truckId: "t1", businessDate: "d", submissionId: "sub-12345678", clientRowId: "r1", row })).toMatchObject({ truckId: "t1", businessDate: "d", submissionId: "sub-12345678", clientRowId: "r1", material: "OTHER", quantity: 12.5 });
  });
  it("correction needs a change, sends the reason, and a material change needs the quantity", () => {
    expect(toCorrectionBody({ quantity: "5", destination: " Pune " }, " Typo ")).toEqual({ quantity: 5, destination: "Pune", reason: "Typo" });
    expect(toCorrectionBody({ material: "Soil", quantity: 3 }, "Fix")).toEqual({ material: "SOIL", quantity: 3, reason: "Fix" });
    expect(() => toCorrectionBody({}, "x")).toThrow("Nothing was changed");
    expect(() => toCorrectionBody({ material: "Soil" }, "Fix")).toThrow(/quantity/);
  });
  it("list query turns booleans into the strings the server expects and leaves empties out", () => {
    expect(toListQuery({ billable: true, includeVoided: true, customerId: "c1" })).toMatchObject({ billable: "true", includeVoided: "true", customerId: "c1" });
    expect(toListQuery({ billable: false })).toMatchObject({ billable: undefined, includeVoided: undefined });
  });
  it("newSubmissionId is a valid, fresh key each time", () => {
    const a = newSubmissionId(); const b = newSubmissionId();
    expect(a).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
    expect(a).not.toBe(b);
  });
});
