import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import Bill from "../models/Bill.js";
import TruckTrip from "../models/TruckTrip.js";
import { compareIndexes, declaredToIndexes, indexSignature } from "../scripts/lib/indexCompare.js";

describe("index comparison", () => {
  it("a database that has exactly the declared indexes has nothing missing and nothing extra", () => {
    const declared = declaredToIndexes(Bill.schema.indexes());
    const actual = [{ name: "_id_", key: { _id: 1 } }, ...declared.map((d, i) => ({ ...d, name: `idx_${i}` }))];
    const r = compareIndexes(actual, declared);
    expect(r.missing).toEqual([]);
    expect(r.extra).toEqual([]);
    expect(r.matching.length).toBe(declared.length);
  });

  it("reports a missing index, including a unique or partial one, and an extra one", () => {
    const declared = declaredToIndexes(TruckTrip.schema.indexes());
    const actual = declared.slice(1).map((d, i) => ({ ...d, name: `idx_${i}` })); // the first one is "missing"
    actual.push({ name: "stray", key: { stray: 1 } });
    const r = compareIndexes(actual, declared);
    expect(r.missing).toEqual([indexSignature(declared[0])]);
    expect(r.extra).toEqual(["stray:1"]);
  });

  it("a unique index is not satisfied by a non-unique one, and key order matters", () => {
    const declared = [{ key: { a: 1, b: 1 }, unique: true }];
    expect(compareIndexes([{ name: "x", key: { a: 1, b: 1 } }], declared).missing).toHaveLength(1);
    expect(compareIndexes([{ name: "x", key: { b: 1, a: 1 }, unique: true }], declared).missing).toHaveLength(1);
    expect(compareIndexes([{ name: "x", key: { a: 1, b: 1 }, unique: true }], declared).missing).toHaveLength(0);
  });

  it("the partial-filter condition is part of the identity", () => {
    const declared = [{ key: { n: 1 }, unique: true, partialFilterExpression: { n: { $type: "string" } } }];
    expect(compareIndexes([{ name: "x", key: { n: 1 }, unique: true }], declared).missing).toHaveLength(1);
    expect(compareIndexes([{ name: "x", key: { n: 1 }, unique: true, partialFilterExpression: { n: { $type: "string" } } }], declared).missing).toHaveLength(0);
  });
});

describe("the production index inspector is read-only", () => {
  const source = readFileSync(new URL("../scripts/inspectIndexes.js", import.meta.url), "utf8");
  const code = source.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");

  it("sends no write or index-changing command", () => {
    expect(code).not.toMatch(/\.(insert\w*|update\w*|delete\w*|replaceOne|bulkWrite|drop\w*|createIndex\w*|ensureIndex\w*|syncIndexes|rename\w*|save|create|remove|findOneAnd\w+)\(/);
  });

  it("uses only ping, listCollections and listIndexes, and turns automatic index building off", () => {
    const calls = [...code.matchAll(/\.(ping|listCollections|listIndexes|collection|admin|db)\(/g)].map((m) => m[1]);
    expect(new Set(calls)).toEqual(new Set(["ping", "listCollections", "listIndexes", "collection", "admin"]));
    expect(code).toMatch(/mongoose\.set\("autoIndex", false\)/);
    expect(code).toMatch(/mongoose\.set\("autoCreate", false\)/);
  });

  it("requires the database name, an exact confirmation and a label before connecting", () => {
    const connectAt = code.indexOf("createConnection(");
    for (const needle of ["--confirm-db", "--label", "has no database name", "connected to"]) expect(source).toContain(needle);
    expect(code.indexOf('option("confirm-db") !== dbName')).toBeLessThan(connectAt);
    expect(code.indexOf('!["production", "test", "other"]')).toBeLessThan(connectAt);
  });

  it("never prints the connection string", () => {
    expect(code).not.toMatch(/console\.\w+\([^)]*\buri\b/);
  });
});
