// Pure helpers for inspectIndexes.js (no database, unit-tested): compare the indexes a database HAS with the ones the app's schemas DECLARE.
const stable = (value) => JSON.stringify(value, (_k, v) => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v));

/** One comparable text for an index: key order matters, name does not. */
export const indexSignature = ({ key, unique = false, partialFilterExpression }) =>
  [Object.entries(key).map(([f, d]) => `${f}:${d}`).join(","), unique ? "UNIQUE" : "", partialFilterExpression ? `PARTIAL ${stable(partialFilterExpression)}` : ""].filter(Boolean).join(" | ");

/** Declared indexes from `schema.indexes()` ([[fields, options], ...]) in the same shape as listIndexes output. */
export const declaredToIndexes = (declared) => declared.map(([key, options = {}]) => ({ key, unique: Boolean(options.unique), partialFilterExpression: options.partialFilterExpression, name: options.name }));

/** `actual` and `declared`: arrays of index specs. `_id_` is ignored. */
export const compareIndexes = (actual, declared) => {
  const have = new Map(actual.filter((i) => i.name !== "_id_").map((i) => [indexSignature(i), i]));
  const want = new Map(declared.map((i) => [indexSignature(i), i]));
  return {
    missing: [...want.keys()].filter((sig) => !have.has(sig)),
    extra: [...have.keys()].filter((sig) => !want.has(sig)),
    matching: [...want.keys()].filter((sig) => have.has(sig)),
  };
};
