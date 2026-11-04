// Tests for Pheera (truck trips): quantity rules, validation, numbering, totals, reports, service.
// Run with Vitest: npx vitest run src/features/trucks
import { describe, expect, it } from "vitest";
import { formatQuantity, materialChoiceOf, matchKnownMaterial, parseQuantity } from "../../utils/materials";
import { isBusinessDate, todayBusinessDate } from "../../utils/businessDate";
import { resolveMaterialName, validateBatch, validatePheeraDraft } from "../../validators/pheeraValidator";
import { buildPheeraRecords, markPheeraDeleted, nextPheeraNumber, numberingGaps } from "./pheeraOps";
import { dailySummaries, decoratePheeras, filterPheeras, knownMaterials, materialFilterOptions, paginate, sortPheeras, summarizePheeras } from "./pheeraSelectors";
import { buildReport, csvSafe, reportToMatrix } from "./truckReports";
import { createTruckTripService } from "../../services/truckTripService";
import { initialPheeras } from "../../mock/truckTrips";
import { initialTrucks } from "../../mock/trucks";

const trucks = [
  { id: "t1", truckNumber: "TRK-01", nickname: "Red" },
  { id: "t2", truckNumber: "TRK-02", nickname: "" },
];
const TODAY = "2026-11-02";
const draft = (o = {}) => ({ material: "Bricks", customMaterial: "", destination: "Palghar", quantity: "1500", remarks: "", ...o });
const rec = (o) => ({
  id: Math.random().toString(36), businessDate: "2026-11-01", truckId: "t1", truckRegistration: "TRK-01", pheeraNumber: 1,
  material: "Bricks", destination: "Palghar", quantity: 1000, unit: "bricks", remarks: "", isDeleted: false, ...o,
});

describe("quantity rules", () => {
  it("bricks: whole positive numbers only", () => {
    expect(parseQuantity("Bricks", "1500")).toEqual({ ok: true, value: 1500 });
    for (const bad of ["", "0", "10.5", "-5", "1e3", "abc", "1,500", " "]) expect(parseQuantity("Bricks", bad).ok).toBe(false);
  });
  it("tonnes: positive, max 2 decimals", () => {
    expect(parseQuantity("Soil", "4.5")).toEqual({ ok: true, value: 4.5 });
    expect(parseQuantity("Soil", ".5").value).toBe(0.5);
    expect(parseQuantity("Soil", "5.").value).toBe(5);
    for (const bad of ["", "0", "0.00", "4.555", "-1", "x", "1e2"]) expect(parseQuantity("Soil", bad).ok).toBe(false);
  });
  it("rejects absurd amounts per Pheera", () => {
    expect(parseQuantity("Bricks", "100001").ok).toBe(false);
    expect(parseQuantity("Stone Dust", "101").ok).toBe(false);
  });
  it("formats quantities", () => {
    expect(formatQuantity(1500, "bricks")).toBe("1,500");
    expect(formatQuantity(4.5, "tonnes")).toBe("4.5");
    expect(formatQuantity(12, "tonnes")).toBe("12");
  });
});

describe("business dates (IST)", () => {
  it("accepts real dates only", () => {
    expect(isBusinessDate("2026-11-02")).toBe(true);
    expect(isBusinessDate("2026-02-30")).toBe(false);
    expect(isBusinessDate("02-11-2026")).toBe(false);
  });
  it("today is read in IST, not UTC", () => {
    // 2026-11-01 20:00 UTC is already 2026-11-02 01:30 in India
    expect(todayBusinessDate(new Date("2026-11-01T20:00:00Z"))).toBe("2026-11-02");
    expect(todayBusinessDate(new Date("2026-11-02T18:00:00Z"))).toBe("2026-11-02");
    expect(todayBusinessDate(new Date("2026-11-02T18:31:00Z"))).toBe("2026-11-03");
  });
});

describe("validation", () => {
  it("cleans a valid row", () => {
    const { value, errors } = validatePheeraDraft(draft({ destination: "  Manor   East " }));
    expect(errors).toEqual({});
    expect(value).toEqual({ material: "Bricks", destination: "Manor East", quantity: 1500, unit: "bricks", remarks: "" });
  });
  it("flags every problem on a blank row", () => {
    const { errors, value } = validatePheeraDraft({ material: "", customMaterial: "", destination: "", quantity: "", remarks: "" });
    expect(value).toBeNull();
    expect(Object.keys(errors).sort()).toEqual(["destination", "material", "quantity"]);
  });
  it("unit follows the material", () => {
    expect(validatePheeraDraft(draft({ material: "Soil", quantity: "4.5" })).value.unit).toBe("tonnes");
  });
  it("batch: needs rows, a past/today date and a known truck", () => {
    const ok = { businessDate: TODAY, truckId: "t1", today: TODAY, trucks, drafts: [draft()] };
    expect(validateBatch(ok).valid).toBe(true);
    expect(validateBatch({ ...ok, drafts: [] }).valid).toBe(false);
    expect(validateBatch({ ...ok, businessDate: "2026-11-03" }).contextErrors.businessDate).toMatch(/future/);
    expect(validateBatch({ ...ok, truckId: "nope" }).contextErrors.truckId).toBeTruthy();
    const mixed = validateBatch({ ...ok, drafts: [draft(), draft({ quantity: "" })] });
    expect(mixed.valid).toBe(false);
    expect(mixed.rowErrors[0]).toEqual({});
    expect(mixed.rowErrors[1].quantity).toBeTruthy();
  });
});

describe("numbering", () => {
  const t = trucks[0];
  const values = [{ material: "Bricks", destination: "A", quantity: 1, unit: "bricks" }, { material: "Sand", destination: "B", quantity: 2, unit: "tonnes" }];
  it("starts at 1 per truck + date and continues", () => {
    expect(nextPheeraNumber([], "t1", "2026-11-01")).toBe(1);
    const first = buildPheeraRecords({ existing: [], truck: t, businessDate: "2026-11-01", values, batchId: "b1" });
    expect(first.map((r) => r.pheeraNumber)).toEqual([1, 2]);
    const second = buildPheeraRecords({ existing: first, truck: t, businessDate: "2026-11-01", values: [values[0]], batchId: "b2" });
    expect(second[0].pheeraNumber).toBe(3);
  });
  it("other trucks and other dates are independent", () => {
    const first = buildPheeraRecords({ existing: [], truck: t, businessDate: "2026-11-01", values, batchId: "b1" });
    expect(nextPheeraNumber(first, "t2", "2026-11-01")).toBe(1);
    expect(nextPheeraNumber(first, "t1", "2026-11-02")).toBe(1);
  });
  it("a deleted number is never reused and nothing is renumbered", () => {
    const first = buildPheeraRecords({ existing: [], truck: t, businessDate: "2026-11-01", values, batchId: "b1" });
    const afterDelete = [markPheeraDeleted(first[0], "wrong entry"), first[1]];
    expect(afterDelete[1].pheeraNumber).toBe(2);
    expect(nextPheeraNumber(afterDelete, "t1", "2026-11-01")).toBe(3);
    expect(numberingGaps(afterDelete, "t1", "2026-11-01")).toEqual([1]);
  });
  it("delete needs a reason", () => {
    expect(() => markPheeraDeleted(rec({}), "  ")).toThrow(/reason/);
  });
  it("snapshots the truck registration", () => {
    expect(buildPheeraRecords({ existing: [], truck: t, businessDate: "2026-11-01", values, batchId: "b" })[0].truckRegistration).toBe("TRK-01");
  });
});

describe("totals never mix units", () => {
  it("sums bricks and tonnes separately, tonnes without float noise", () => {
    const rows = [rec({ quantity: 1000 }), rec({ quantity: 1500 }), rec({ material: "Sand", unit: "tonnes", quantity: 0.1 }), rec({ material: "Sand", unit: "tonnes", quantity: 0.2 })];
    const s = summarizePheeras(rows);
    expect(s).toEqual({ count: 4, bricks: 2500, tonnes: 0.3, brickCount: 2, tonneCount: 2 });
  });
});

describe("filters, sort, group, paginate", () => {
  const rows = decoratePheeras(
    [
      rec({ id: "a", businessDate: "2026-11-01", destination: "Palghar" }),
      rec({ id: "b", businessDate: "2026-10-30", truckId: "t2", truckRegistration: "TRK-02", destination: "Manor", material: "Sand", unit: "tonnes", quantity: 4 }),
      rec({ id: "c", businessDate: "2026-10-30", isDeleted: true }),
    ],
    trucks
  );
  it("hides deleted records", () => expect(rows.map((r) => r.id)).toEqual(["a", "b"]));
  it("filters by date, range, truck, material, destination, search", () => {
    expect(filterPheeras(rows, { date: "2026-11-01" })).toHaveLength(1);
    expect(filterPheeras(rows, { from: "2026-10-30", to: "2026-11-01" })).toHaveLength(2);
    expect(filterPheeras(rows, { truckId: "t2" })[0].id).toBe("b");
    expect(filterPheeras(rows, { material: "Sand" })[0].id).toBe("b");
    expect(filterPheeras(rows, { destination: "palg" })[0].id).toBe("a");
    expect(filterPheeras(rows, { search: "red" })[0].id).toBe("a"); // nickname
    expect(filterPheeras(rows, { search: "trk-02" })[0].id).toBe("b");
  });
  it("shows the current registration after a truck number change", () => {
    const renamed = decoratePheeras([rec({})], [{ id: "t1", truckNumber: "MH04-NEW" }]);
    expect(renamed[0].registration).toBe("MH04-NEW");
  });
  it("sorts newest first and summarises per day", () => {
    expect(sortPheeras(rows).map((r) => r.id)).toEqual(["a", "b"]);
    expect(dailySummaries(rows).map((d) => d.date)).toEqual(["2026-11-01", "2026-10-30"]);
  });
  it("paginates safely", () => {
    const many = Array.from({ length: 45 }, (_, i) => i);
    expect(paginate(many, 1, 20).items).toHaveLength(20);
    expect(paginate(many, 3, 20).items).toHaveLength(5);
    expect(paginate(many, 99, 20).page).toBe(3);
    expect(paginate([], 1, 20).pageCount).toBe(1);
  });
});

describe("reports", () => {
  const rows = decoratePheeras(
    [
      rec({ businessDate: "2026-11-01", pheeraNumber: 1, quantity: 1000 }),
      rec({ businessDate: "2026-11-01", pheeraNumber: 2, material: "Sand", unit: "tonnes", quantity: 4.5, destination: "=HYPERLINK(\"x\")" }),
      rec({ businessDate: "2026-11-02", pheeraNumber: 1, truckId: "t2", truckRegistration: "TRK-02", quantity: 2000 }),
    ],
    trucks
  );
  const base = { from: "2026-11-01", to: "2026-11-02" };
  it("rejects incomplete or invalid parameters", () => {
    expect(buildReport({ rows, trucks, params: { type: "daily" } }).error).toBeTruthy();
    expect(buildReport({ rows, trucks, params: { type: "range", from: "2026-11-02", to: "2026-11-01" } }).error).toMatch(/before/);
    expect(buildReport({ rows, trucks, params: { type: "truck", ...base } }).error).toMatch(/truck/i);
  });
  it("lists individual Pheera with subtotals and grand totals per unit", () => {
    const m = buildReport({ rows, trucks, params: { type: "range", ...base } });
    expect(m.count).toBe(3);
    expect(m.sections.map((s) => s.heading)).toHaveLength(2);
    expect(m.grand.totals).toEqual([{ unit: "bricks", count: 2, quantity: 3000 }, { unit: "tonnes", count: 1, quantity: 4.5 }]);
    const x = reportToMatrix(m);
    expect(x.kinds.filter((k) => k === "data")).toHaveLength(3);
    expect(x.kinds.filter((k) => k === "total")).toHaveLength(2);
    expect(x.rows.find((r, i) => x.kinds[i] === "total" && r[6] === "bricks")[5]).toBe(3000);
  });
  it("daily report groups by truck; material report by material", () => {
    expect(buildReport({ rows, trucks, params: { type: "daily", date: "2026-11-01" } }).sections).toHaveLength(1);
    expect(buildReport({ rows, trucks, params: { type: "material", ...base } }).sections.map((s) => s.heading)).toEqual(["Material: Bricks", "Material: Sand"]);
  });
  it("applies truck / material / destination filters", () => {
    expect(buildReport({ rows, trucks, params: { type: "truck", truckId: "t2", ...base } }).count).toBe(1);
    expect(buildReport({ rows, trucks, params: { type: "all", material: "Sand", ...base } }).count).toBe(1);
  });
  it("empty result is a valid report with no rows", () => {
    const m = buildReport({ rows, trucks, params: { type: "range", from: "2020-01-01", to: "2020-01-02" } });
    expect(m.count).toBe(0);
    expect(reportToMatrix(m).rows).toHaveLength(0);
  });
  it("neutralises spreadsheet formulas in CSV", () => {
    expect(csvSafe("=1+1")).toBe("'=1+1");
    expect(csvSafe("Palghar")).toBe("Palghar");
    expect(csvSafe(5)).toBe(5);
    const m = buildReport({ rows, trucks, params: { type: "range", ...base } });
    expect(reportToMatrix(m, { safe: true }).rows.some((r) => String(r[4]).startsWith("'="))).toBe(true);
  });
});

describe("service", () => {
  const input = (o = {}) => ({ batchId: "b1", businessDate: TODAY, truckId: "t1", drafts: [draft(), draft({ material: "Soil", quantity: "4.5" })], trucks, today: TODAY, ...o });
  it("saves a batch with server-side numbers", async () => {
    const svc = createTruckTripService([]);
    const { records, duplicate } = await svc.savePheeraBatch(input());
    expect(duplicate).toBe(false);
    expect(records.map((r) => r.pheeraNumber)).toEqual([1, 2]);
    const again = await svc.savePheeraBatch(input({ batchId: "b2", drafts: [draft()] }));
    expect(again.records[0].pheeraNumber).toBe(3);
  });
  it("a repeated batchId does not save twice", async () => {
    const svc = createTruckTripService([]);
    await svc.savePheeraBatch(input());
    const second = await svc.savePheeraBatch(input());
    expect(second.duplicate).toBe(true);
    expect(await svc.listPheeras()).toHaveLength(2);
  });
  it("an invalid row saves nothing (all or none)", async () => {
    const svc = createTruckTripService([]);
    let failed = false;
    try { await svc.savePheeraBatch(input({ drafts: [draft(), draft({ quantity: "" })] })); } catch { failed = true; }
    expect(failed).toBe(true);
    expect(await svc.listPheeras()).toHaveLength(0);
  });
  it("delete keeps the record but marks it", async () => {
    const svc = createTruckTripService([]);
    const { records } = await svc.savePheeraBatch(input());
    await svc.deletePheera(records[0].id, "typed twice");
    const all = await svc.listPheeras();
    expect(all).toHaveLength(2);
    expect(all[0].isDeleted).toBe(true);
    expect(decoratePheeras(all, trucks)).toHaveLength(1);
  });
});

describe("materials: Bricks, Soil, Other", () => {
  const row = (o) => validatePheeraDraft(draft(o));
  it("Bricks: Number of Bricks, whole numbers only", () => {
    expect(row({ material: "Bricks", quantity: "1500" }).value).toEqual({ material: "Bricks", destination: "Palghar", quantity: 1500, unit: "bricks", remarks: "" });
    expect(row({ material: "Bricks", quantity: "10.5" }).errors.quantity).toBeTruthy();
  });
  it("Soil: tonnes, decimals allowed", () => {
    const { value } = row({ material: "Soil", quantity: "4.5" });
    expect(value.material).toBe("Soil");
    expect(value.unit).toBe("tonnes");
    expect(value.quantity).toBe(4.5);
  });
  it("Other: the typed name is saved, trimmed, in tonnes", () => {
    const { value, errors } = row({ material: "Other", customMaterial: "   Stone   Dust ", quantity: "3.25" });
    expect(errors).toEqual({});
    expect(value.material).toBe("Stone Dust"); // never just "Other"
    expect(value.unit).toBe("tonnes");
    expect(value.quantity).toBe(3.25);
  });
  it("Other: a name is required, and it cannot be Bricks / Soil / Other", () => {
    expect(row({ material: "Other", customMaterial: "", quantity: "3" }).errors.customMaterial).toBeTruthy();
    expect(row({ material: "Other", customMaterial: "    ", quantity: "3" }).errors.customMaterial).toBeTruthy();
    expect(row({ material: "Other", customMaterial: "bricks", quantity: "3" }).errors.customMaterial).toMatch(/Bricks/);
    expect(row({ material: "Other", customMaterial: "SOIL", quantity: "3" }).errors.customMaterial).toMatch(/Soil/);
    expect(row({ material: "Other", customMaterial: "other", quantity: "3" }).errors.customMaterial).toMatch(/not Other/);
    expect(row({ material: "Other", customMaterial: "x".repeat(41), quantity: "3" }).errors.customMaterial).toMatch(/too long/);
  });
  it("only Bricks, Soil and Other can be chosen (no Sand / Cement / Stone for new entries)", () => {
    for (const old of ["Sand", "Cement", "Stone", ""]) expect(row({ material: old }).errors.material).toBeTruthy();
  });
  it("Other is always checked as tonnes, even before / without a valid name", () => {
    const r = row({ material: "Other", customMaterial: "", quantity: "3.5" });
    expect(r.errors.quantity).toBeUndefined();          // only the missing name is reported
    expect(r.errors.customMaterial).toBeTruthy();
    expect(row({ material: "Other", customMaterial: "Bricks", quantity: "3.5" }).errors.quantity).toBeUndefined();
    expect(row({ material: "Other", customMaterial: "Gravel", quantity: "3.555" }).errors.quantity).toBeTruthy();
  });
  it("a name typed under another choice is ignored", () => {
    expect(resolveMaterialName({ material: "Soil", customMaterial: "Stone Dust" })).toBe("Soil");
    expect(resolveMaterialName({ material: "Other", customMaterial: " Fly Ash " })).toBe("Fly Ash");
    expect(resolveMaterialName({ material: "", customMaterial: "x" })).toBe("");
  });
  it("maps a saved name back to the dropdown (for restoring a record)", () => {
    expect(materialChoiceOf("Bricks")).toBe("Bricks");
    expect(materialChoiceOf("Soil")).toBe("Soil");
    expect(materialChoiceOf("Stone Dust")).toBe("Other");
    expect(materialChoiceOf("Sand")).toBe("Other"); // older record
  });
  it("reuses an existing spelling that differs only by capitals", () => {
    expect(matchKnownMaterial("stone dust", ["Fly Ash", "Stone Dust"])).toBe("Stone Dust");
    expect(matchKnownMaterial("Gravel", ["Stone Dust"])).toBe("Gravel");
  });
  it("saves the real name and unit through the service, whole batch", async () => {
    const svc = createTruckTripService([]);
    const { records } = await svc.savePheeraBatch({
      batchId: "m1", businessDate: TODAY, truckId: "t1", trucks, today: TODAY,
      drafts: [draft({ material: "Other", customMaterial: " Stone Dust ", quantity: "4" }), draft({ material: "Soil", quantity: "5.5" }), draft()],
    });
    expect(records.map((r) => [r.material, r.unit, r.quantity])).toEqual([["Stone Dust", "tonnes", 4], ["Soil", "tonnes", 5.5], ["Bricks", "bricks", 1500]]);
  });
  const data = decoratePheeras(
    [
      rec({ id: "b1", material: "Bricks", quantity: 1000 }),
      rec({ id: "s1", material: "Soil", unit: "tonnes", quantity: 4 }),
      rec({ id: "d1", material: "Stone Dust", unit: "tonnes", quantity: 3 }),
      rec({ id: "d2", material: "Stone Dust", unit: "tonnes", quantity: 2.5 }),
      rec({ id: "f1", material: "Fly Ash", unit: "tonnes", quantity: 2 }),
      rec({ id: "o1", material: "Sand", unit: "tonnes", quantity: 6 }), // older record, kept as saved
    ],
    trucks
  );
  it("filters list Bricks and Soil first, then every other saved name", () => {
    expect(knownMaterials(data)).toEqual(["Stone Dust", "Fly Ash", "Sand"]);
    expect(materialFilterOptions(data).slice(0, 2)).toEqual(["Bricks", "Soil"]);
  });
  it("filters and searches by the actual custom name", () => {
    expect(filterPheeras(data, { material: "Stone Dust" }).map((r) => r.id)).toEqual(["d1", "d2"]);
    expect(filterPheeras(data, { material: "stone dust" })).toHaveLength(2);
    expect(filterPheeras(data, { search: "fly" }).map((r) => r.id)).toEqual(["f1"]);
    expect(filterPheeras(data, { material: "Other" })).toHaveLength(0); // "Other" is never a saved name
  });
  it("material-wise report keeps every custom material separate, in its own unit", () => {
    const m = buildReport({ rows: data, trucks, params: { type: "material", from: "2026-11-01", to: "2026-11-01" } });
    expect(m.sections.map((s) => s.heading).sort()).toEqual(["Material: Bricks", "Material: Fly Ash", "Material: Sand", "Material: Soil", "Material: Stone Dust"]);
    const byName = Object.fromEntries(m.sections.map((s) => [s.heading, s.totals]));
    expect(byName["Material: Stone Dust"]).toEqual([{ unit: "tonnes", count: 2, quantity: 5.5 }]);
    expect(byName["Material: Fly Ash"]).toEqual([{ unit: "tonnes", count: 1, quantity: 2 }]);
    expect(byName["Material: Bricks"]).toEqual([{ unit: "bricks", count: 1, quantity: 1000 }]);
    expect(m.sections.some((s) => s.heading === "Material: Other")).toBe(false);
    expect(m.grand.totals).toEqual([{ unit: "bricks", count: 1, quantity: 1000 }, { unit: "tonnes", count: 5, quantity: 17.5 }]);
  });
  it("exports show the custom name, not Other", () => {
    const m = buildReport({ rows: data, trucks, params: { type: "range", from: "2026-11-01", to: "2026-11-01" } });
    const names = reportToMatrix(m).rows.filter((_, i) => reportToMatrix(m).kinds[i] === "data").map((r) => r[3]);
    expect(names).toContain("Stone Dust");
    expect(names).not.toContain("Other");
  });
});

describe("demo data", () => {
  it("is valid and consistent", () => {
    expect(initialPheeras.length).toBeGreaterThan(50);
    const ids = new Set(initialPheeras.map((r) => r.id));
    expect(ids.size).toBe(initialPheeras.length);
    const truckIds = new Set(initialTrucks.map((t) => t.id));
    for (const r of initialPheeras) {
      expect(truckIds.has(r.truckId)).toBe(true);
      expect(isBusinessDate(r.businessDate)).toBe(true);
      expect(r.businessDate <= todayBusinessDate()).toBe(true);
      // restoring a saved record into the form (dropdown choice + typed name) gives back the same material, quantity and unit
      const choice = materialChoiceOf(r.material);
      const back = validatePheeraDraft({ material: choice, customMaterial: choice === "Other" ? r.material : "", destination: r.destination, quantity: String(r.quantity), remarks: r.remarks }).value;
      expect([back.material, back.quantity, back.unit]).toEqual([r.material, r.quantity, r.unit]);
    }
    // Bricks, Soil and at least one typed material (no Sand / Cement / Stone any more)
    const names = new Set(initialPheeras.map((r) => r.material));
    expect(names.has("Bricks") && names.has("Soil") && names.has("Stone Dust")).toBe(true);
    for (const old of ["Sand", "Cement", "Stone", "Other"]) expect(names.has(old)).toBe(false);
    // numbers are unique per truck + date
    const keys = initialPheeras.map((r) => `${r.truckId}|${r.businessDate}|${r.pheeraNumber}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
