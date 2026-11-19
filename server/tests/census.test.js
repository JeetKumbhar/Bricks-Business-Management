import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EXIT, checkCensusGuards, formatCensus, runCensus } from "../scripts/lib/census.js";

const HOST = "aayush-carting.7xmegwh.mongodb.net";
const uri = (db = "aayush_carting_test", host = HOST) => `mongodb+srv://u:p@${host}/${db}?retryWrites=true`;
const okArgv = ["--read-only-census", "--confirm-db", "aayush_carting_test", "--confirm-host", HOST];

describe("census guards refuse anything but the confirmed TEST database", () => {
  it("accepts only the exact combination", () => {
    expect(checkCensusGuards({ argv: okArgv, env: { MONGODB_URI: uri() } })).toMatchObject({ ok: true, dbName: "aayush_carting_test" });
  });
  it.each([
    ["no flag", okArgv.slice(1), { MONGODB_URI: uri() }],
    ["production NODE_ENV", okArgv, { MONGODB_URI: uri(), NODE_ENV: "production" }],
    ["other database", okArgv, { MONGODB_URI: uri("aayush_carting") }],
    ["no database name", okArgv, { MONGODB_URI: `mongodb+srv://u:p@${HOST}/?x=1` }],
    ["other cluster", okArgv, { MONGODB_URI: uri("aayush_carting_test", "other.mongodb.net") }],
    ["missing confirm-db", ["--read-only-census", "--confirm-host", HOST], { MONGODB_URI: uri() }],
    ["missing confirm-host", ["--read-only-census", "--confirm-db", "aayush_carting_test"], { MONGODB_URI: uri() }],
    ["no uri", okArgv, {}],
  ])("refuses: %s", (_n, argv, env) => {
    const r = checkCensusGuards({ argv, env });
    expect(r.ok).toBe(false);
    expect(r.problem).not.toMatch(/mongodb\+srv|:p@/);
  });
});

const data = () => ({
  labours: [
    { _id: "L-001", labourType: "BIGARI", joiningDate: "2026-01-10", isDeleted: false },
    { _id: "L-002", labourType: "MAAPVALI", joiningDate: "2026-01-10" }, // labours have no isDeleted field (status is used)
    { _id: "L-007", labourType: "BIGARI", joiningDate: "2026-02-01", isDeleted: false }, // no rate rows
  ],
  rates: [{ labourId: "L-001", ratePaise: 65000 }, { labourId: "L-002", ratePaise: 0 }],
  attendance: [{ _id: "a1", labourId: "L-001", date: "2026-01-05" }, { _id: "a2", labourId: "L-007", date: "2026-02-03" }, { _id: "a3", labourId: "L-999", date: "2026-02-03" }],
  maap: [{ _id: "m1", labourId: "L-002", date: "2026-01-01", ratePaise: 25000, earningsPaise: 12.5, isDeleted: false }, { _id: "m2", labourId: "L-002", date: "2026-01-01", ratePaise: 25000, earningsPaise: 100, isDeleted: true }],
  production: [],
  payments: [
    { _id: "p1", recipientId: "L-001", type: "BOOKING_ADVANCE", amountPaise: 1000, date: "2025-12-01", isDeleted: false },
    { _id: "p2", recipientId: "L-001", type: "SALARY_PAYMENT", amountPaise: -5, date: "2026-01-01", isDeleted: false },
  ],
  seasons: [],
  counters: [{ _id: "labour", seq: 3 }],
});
const reader = (d, log = []) => async (name, filter) => {
  log.push([name, filter]);
  return JSON.parse(JSON.stringify(d[name]));
};
const by = (result, key) => result.findings.find((f) => f.key === key);

describe("census findings", () => {
  it("reports counts and representative ids for every approved check", async () => {
    const r = await runCensus(reader(data()));
    expect(by(r, "missingIsDeleted.labours")).toBeUndefined(); // labours are not checked for isDeleted
    expect(by(r, "badMoney.rates")).toMatchObject({ count: 1 });
    expect(by(r, "badMoney.maap")).toMatchObject({ count: 1, sampleIds: ["m1"] });
    expect(by(r, "badMoney.payments")).toMatchObject({ count: 1, sampleIds: ["p2"] });
    expect(by(r, "noRateRows")).toMatchObject({ count: 1, sampleIds: ["L-007"], attendanceDaysAffected: 1 });
    expect(by(r, "beforeJoining.attendance")).toMatchObject({ count: 1, sampleIds: ["a1"] });
    expect(by(r, "beforeJoining.maap")).toMatchObject({ count: 1, sampleIds: ["m1"] }); // the deleted one is ignored
    expect(by(r, "beforeJoining.payments")).toMatchObject({ count: 1, sampleIds: ["p2"] }); // Bayana p1 is allowed
    expect(by(r, "orphans").count).toBe(1);
  });

  it("flags a counter behind the highest labour id, and a missing counter", async () => {
    expect(by(await runCensus(reader(data())), "labourCounter")).toMatchObject({ count: 1, counter: 3, highestLabourId: 7 });
    const none = data();
    none.counters = [];
    expect(by(await runCensus(reader(none)), "labourCounter")).toMatchObject({ count: 1, counter: null });
    const ahead = data();
    ahead.counters = [{ _id: "labour", seq: 20 }];
    expect(by(await runCensus(reader(ahead)), "labourCounter").count).toBe(0);
  });

  it("a clean database reports no issues", async () => {
    const r = await runCensus(reader({ labours: [], rates: [], attendance: [], maap: [], production: [], payments: [], seasons: [], counters: [{ _id: "labour", seq: 0 }] }));
    expect(r.issues).toBe(0);
    expect(formatCensus(r, { dbName: "d", host: "h" }).join("\n")).toContain("no issues");
  });

  it("only reads (every call is a read of a named collection with a filter) and never changes its input", async () => {
    const d = data();
    const before = JSON.stringify(d);
    const log = [];
    await runCensus(reader(d, log));
    expect(JSON.stringify(d)).toBe(before);
    expect(log.length).toBe(8);
    expect(log.every(([name, filter]) => typeof name === "string" && Object.keys(filter).length === 0)).toBe(true);
  });

  it("the report never prints a connection string and states that nothing was written", async () => {
    const text = formatCensus(await runCensus(reader(data())), { dbName: "aayush_carting_test", host: HOST }).join("\n");
    expect(text).toContain("nothing was written");
    expect(text).not.toMatch(/mongodb(\+srv)?:\/\//);
  });
});

describe("isDeleted check: only exactly true or false is valid", () => {
  const withFlags = (flags) => {
    const d = { labours: [], rates: [], attendance: [], maap: [], production: [], payments: [], seasons: [], counters: [{ _id: "labour", seq: 0 }] };
    d.maap = flags.map(([id, value], i) => ({ _id: `m${i + 1}`, ...(value === "<missing>" ? {} : { isDeleted: value }), tag: id }));
    return d;
  };
  it("flags missing, null and invalid values and accepts false and true", async () => {
    const r = await runCensus(reader(withFlags([["missing", "<missing>"], ["null", null], ["string", "false"], ["zero", 0], ["one", 1], ["empty", ""], ["false", false], ["true", true]])));
    const f = by(r, "missingIsDeleted.maapentries");
    expect(f.count).toBe(6);
    expect(f.sampleIds).toEqual(["m1", "m2", "m3", "m4", "m5"]); // false (m7) and true (m8) are never listed
    expect(f.title).toMatch(/not exactly true or false/);
  });
  it("false and true alone are clean", async () => {
    expect(by(await runCensus(reader(withFlags([["a", false], ["b", true]]))), "missingIsDeleted.maapentries").count).toBe(0);
  });
  it("applies to the three collections that use soft delete", async () => {
    const d = data();
    d.maap = [{ _id: "m", isDeleted: null }];
    d.production = [{ _id: "pr", isDeleted: "no" }];
    d.payments = [{ _id: "pa", isDeleted: undefined }];
    const r = await runCensus(reader(d));
    for (const [k, id] of [["maapentries", "m"], ["productionentries", "pr"], ["payments", "pa"]]) expect(by(r, `missingIsDeleted.${k}`)).toMatchObject({ count: 1, sampleIds: [id] });
  });
  it("regression: labours and seasons are excluded from the check", async () => {
    const d = data();
    d.labours = [{ _id: "L-001", labourType: "BIGARI", joiningDate: "2026-01-01" }, { _id: "L-002", labourType: "BIGARI", joiningDate: "2026-01-01", isDeleted: null }];
    d.seasons = [{ _id: "s1" }, { _id: "s2", isDeleted: 0 }];
    const r = await runCensus(reader(d));
    const keys = r.findings.map((f) => f.key);
    expect(keys).not.toContain("missingIsDeleted.labours");
    expect(keys).not.toContain("missingIsDeleted.seasons");
    expect(keys.filter((k) => k.startsWith("missingIsDeleted."))).toEqual(["missingIsDeleted.maapentries", "missingIsDeleted.productionentries", "missingIsDeleted.payments"]);
  });
});

describe("the census source can only read", () => {
  const WRITES = /\b(insertOne|insertMany|updateOne|updateMany|replaceOne|deleteOne|deleteMany|findOneAndUpdate|findOneAndDelete|findOneAndReplace|bulkWrite|drop|dropIndex|dropIndexes|createIndex|createIndexes|syncIndexes|ensureIndexes|save|create|remove|rename|\$set|\$unset|\$inc)\b/;
  const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\/\/ .*$/gm, "");
  for (const file of ["scripts/lib/census.js", "scripts/censusHistorical.js"]) {
    it(`${file} has no write call`, () => {
      expect(WRITES.test(strip(readFileSync(new URL(`../${file}`, import.meta.url), "utf8")).replace(/'[^']*'|"[^"]*"|`[^`]*`/g, '""'))).toBe(false);
    });
  }
  it("the script forces autoIndex/autoCreate off before any model and exits 2 on refusal", () => {
    const s = readFileSync(new URL("../scripts/censusHistorical.js", import.meta.url), "utf8");
    expect(s.indexOf("applyIndexSafety(mongoose)")).toBeLessThan(s.indexOf('import("../models/'));
    expect(EXIT.REFUSED).toBe(2);
  });
});
