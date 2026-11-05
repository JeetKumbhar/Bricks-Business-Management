import mongoose from "mongoose";
// A small in-memory stand-in for the labour collections, so the service and routes can be tested without MongoDB.
// It wraps the REAL Mongoose models for validation, defaults and trimming (validateSync / hydrate), and imitates only
// what the labour service uses: unique indexes (as E11000), simple filters ($and, $or, $in, $ne, RegExp) and sort/skip/limit.
// structuredClone drops the prototype of an ObjectId, so a copied row keeps the original _id object (as a real driver returns it).
const clone = (value) => {
  const copy = structuredClone(value);
  if (value && typeof value._id === "object") copy._id = value._id;
  return copy;
};

const matchValue = (actual, cond) => {
  if (cond instanceof RegExp) return typeof actual === "string" && cond.test(actual);
  if (cond && typeof cond === "object") {
    if ("$in" in cond) return cond.$in.includes(actual);
    if ("$ne" in cond) return String(actual) !== String(cond.$ne);
    if ("$gte" in cond || "$lte" in cond) return typeof actual === "string" && (!("$gte" in cond) || actual >= cond.$gte) && (!("$lte" in cond) || actual <= cond.$lte);
    throw new Error(`memoryDb: unsupported operator ${JSON.stringify(cond)}`);
  }
  return actual === cond;
};
export const matches = (doc, filter = {}) =>
  Object.entries(filter).every(([key, cond]) => {
    if (key === "$and") return cond.every((f) => matches(doc, f));
    if (key === "$or") return cond.some((f) => matches(doc, f));
    return matchValue(doc[key], cond);
  });

class Query {
  constructor(rows) {
    this.rows = rows;
  }
  sort(spec) {
    const keys = Object.entries(spec);
    this.rows.sort((a, b) => {
      for (const [key, dir] of keys) {
        if (a[key] < b[key]) return -dir;
        if (a[key] > b[key]) return dir;
      }
      return 0;
    });
    return this;
  }
  skip(n) {
    this.rows = this.rows.slice(n);
    return this;
  }
  limit(n) {
    this.rows = this.rows.slice(0, n);
    return this;
  }
  lean() {
    return this;
  }
  then(resolve, reject) {
    return Promise.resolve(this.rows.map(clone)).then(resolve, reject);
  }
}

const duplicate = (keyPattern) => Object.assign(new Error("E11000 duplicate key error"), { code: 11000, keyPattern });
const raw = (doc) => doc.toObject({ transform: false });

export const db = {
  labours: new Map(),
  rates: [],
  attendance: new Map(), // key "labourId|date"
  maap: new Map(), // key = _id
  seasons: new Map(), // key = _id
  production: new Map(), // key = _id
  counters: {},
  failNextRateCreate: false,
  reset() {
    this.labours.clear();
    this.rates.length = 0;
    this.attendance.clear();
    this.maap.clear();
    this.seasons.clear();
    this.production.clear();
    this.beforeProductionUpdate = null;
    this.failNextProductionWrite = null;
    this.beforeMaapUpdate = null;
    this.failNextMaapWrite = null;
    this.failNextAttendanceWrite = null;
    this.counters = {};
    this.failNextRateCreate = false;
  },
};

export const makeCounterModel = () => ({
  async findOneAndUpdate({ _id }, update) {
    db.counters[_id] = (db.counters[_id] ?? 0) + update.$inc.seq;
    return { _id, seq: db.counters[_id] };
  },
});

export const makeLabourModel = (Real) => {
  const assertUnique = (row) => {
    for (const other of db.labours.values()) if (other._id !== row._id && other.mobile === row.mobile) throw duplicate({ mobile: 1 });
  };
  const persist = (doc, isNew) => {
    const err = doc.validateSync();
    if (err) throw err;
    const row = raw(doc);
    assertUnique(row);
    const now = new Date();
    row.createdAt = isNew ? now : db.labours.get(row._id).createdAt;
    row.updatedAt = now;
    db.labours.set(row._id, row);
    return row;
  };
  return {
    async exists(filter) {
      const row = [...db.labours.values()].find((r) => matches(r, filter));
      return row ? { _id: row._id } : null;
    },
    async countDocuments(filter) {
      return [...db.labours.values()].filter((r) => matches(r, filter)).length;
    },
    find(filter) {
      return new Query([...db.labours.values()].filter((r) => matches(r, filter)).map(clone));
    },
    async findById(id) {
      const row = db.labours.get(id);
      if (!row) return null;
      const doc = Real.hydrate(clone(row));
      doc.save = async () => {
        persist(doc, false);
        return doc;
      };
      return doc;
    },
    async create(data) {
      const doc = new Real(data);
      persist(doc, true);
      return doc;
    },
    async deleteOne({ _id }) {
      db.labours.delete(_id);
    },
  };
};

export const makeRateModel = (Real) => ({
  find(filter) {
    return new Query(db.rates.filter((r) => matches(r, filter)).map(clone));
  },
  async create(data) {
    if (db.failNextRateCreate) {
      db.failNextRateCreate = false;
      throw new Error("simulated database failure");
    }
    const doc = new Real(data);
    const err = doc.validateSync();
    if (err) throw err;
    const row = raw(doc);
    if (db.rates.some((r) => r.labourId === row.labourId && r.effectiveFrom === row.effectiveFrom)) throw duplicate({ labourId: 1, effectiveFrom: 1 });
    row.createdAt = new Date();
    db.rates.push(row);
    doc.createdAt = row.createdAt;
    return doc;
  },
  async updateOne({ _id }, { $set }) {
    const row = db.rates.find((r) => String(r._id) === String(_id));
    if (row) Object.assign(row, $set);
  },
});

/**
 * In-memory Attendance collection: the unique (labourId, date) index, upsert with $setOnInsert, and the $set / $inc / $push
 * updates the attendance service uses. `db.beforeAttendanceUpdate` lets a test change data between the service's read and write.
 */
export const makeAttendanceModel = () => {
  let seq = 0;
  const keyOf = (r) => `${r.labourId}|${r.date}`;
  const rows = () => [...db.attendance.values()];
  return {
    find(filter) {
      return new Query(rows().filter((r) => matches(r, filter)).map(clone));
    },
    async countDocuments(filter) {
      return rows().filter((r) => matches(r, filter)).length;
    },
    async updateOne(filter, update, options = {}) {
      if (db.failNextAttendanceWrite === "duplicate") {
        db.failNextAttendanceWrite = null;
        throw duplicate({ labourId: 1, date: 1 });
      }
      db.beforeAttendanceUpdate?.(filter);
      const found = rows().find((r) => matches(r, filter));
      const now = new Date();
      if (!found) {
        if (!options.upsert) return { matchedCount: 0, modifiedCount: 0, upsertedCount: 0 };
        const row = { _id: `att-${(seq += 1)}`, ...clone(update.$setOnInsert ?? {}), createdAt: now, updatedAt: now };
        if (db.attendance.has(keyOf(row))) throw duplicate({ labourId: 1, date: 1 });
        db.attendance.set(keyOf(row), row);
        return { matchedCount: 0, modifiedCount: 0, upsertedCount: 1 };
      }
      Object.assign(found, clone(update.$set ?? {}));
      for (const [k, by] of Object.entries(update.$inc ?? {})) found[k] = (found[k] ?? 0) + by;
      for (const [k, v] of Object.entries(update.$push ?? {})) found[k] = [...(found[k] ?? []), clone(v)];
      found.updatedAt = now;
      return { matchedCount: 1, modifiedCount: 1, upsertedCount: 0 };
    },
  };
};

/**
 * In-memory MaapEntry collection: the partial unique index (one LIVE entry per labourId + date), upsert with $setOnInsert,
 * and the $set / $inc / $push updates the Maapvali service uses. `db.beforeMaapUpdate` lets a test change data between the
 * service's read and its write.
 */
export const makeMaapEntryModel = () => {
  const rows = () => [...db.maap.values()];
  const liveClash = (row) => rows().some((r) => r._id !== row._id && !r.isDeleted && !row.isDeleted && r.labourId === row.labourId && r.date === row.date);
  return {
    find(filter) {
      return new Query(rows().filter((r) => matches(r, filter)).map(clone));
    },
    async countDocuments(filter) {
      return rows().filter((r) => matches(r, filter)).length;
    },
    async updateOne(filter, update, options = {}) {
      if (db.failNextMaapWrite === "duplicate") {
        db.failNextMaapWrite = null;
        throw duplicate({ labourId: 1, date: 1 });
      }
      db.beforeMaapUpdate?.(filter);
      const found = rows().find((r) => matches(r, filter));
      const now = new Date();
      if (!found) {
        if (!options.upsert) return { matchedCount: 0, modifiedCount: 0, upsertedCount: 0 };
        const row = { _id: new mongoose.Types.ObjectId().toString(), ...clone(update.$setOnInsert ?? {}), createdAt: now, updatedAt: now };
        if (liveClash(row)) throw duplicate({ labourId: 1, date: 1 });
        db.maap.set(row._id, row);
        return { matchedCount: 0, modifiedCount: 0, upsertedCount: 1 };
      }
      const next = { ...found, ...clone(update.$set ?? {}) };
      for (const [k, by] of Object.entries(update.$inc ?? {})) next[k] = (next[k] ?? 0) + by;
      for (const [k, v] of Object.entries(update.$push ?? {})) next[k] = [...(next[k] ?? []), clone(v)];
      if (liveClash(next)) throw duplicate({ labourId: 1, date: 1 });
      Object.assign(found, next, { updatedAt: now });
      return { matchedCount: 1, modifiedCount: 1, upsertedCount: 0 };
    },
  };
};

/** In-memory Season collection: unique name, create (validated by the real schema), find and a revision-guarded updateOne. */
export const makeSeasonModel = (Real) => {
  const rows = () => [...db.seasons.values()];
  const nameClash = (row) => rows().some((r) => r._id !== row._id && r.name === row.name);
  return {
    find(filter) {
      return new Query(rows().filter((r) => matches(r, filter)).map(clone));
    },
    async create(data) {
      const doc = new Real(data);
      const err = doc.validateSync();
      if (err) throw err;
      const row = raw(doc);
      row._id = String(row._id);
      if (nameClash(row)) throw duplicate({ name: 1 });
      row.createdAt = row.updatedAt = new Date();
      db.seasons.set(row._id, row);
      return { toObject: () => clone(row) };
    },
    async updateOne(filter, update) {
      const found = rows().find((r) => matches(r, filter));
      if (!found) return { matchedCount: 0, modifiedCount: 0 };
      const next = { ...found, ...clone(update.$set ?? {}) };
      for (const [k, by] of Object.entries(update.$inc ?? {})) next[k] = (next[k] ?? 0) + by;
      if (nameClash(next)) throw duplicate({ name: 1 });
      Object.assign(found, next, { updatedAt: new Date() });
      return { matchedCount: 1, modifiedCount: 1 };
    },
  };
};

/**
 * In-memory ProductionEntry collection: the partial unique index (one LIVE entry per teamId + date), upsert with
 * $setOnInsert, and the $set / $inc / $push updates the production service uses. `db.beforeProductionUpdate` lets a test
 * change data between the service's read and its write.
 */
export const makeProductionEntryModel = () => {
  const rows = () => [...db.production.values()];
  const liveClash = (row) => rows().some((r) => r._id !== row._id && !r.isDeleted && !row.isDeleted && r.teamId === row.teamId && r.date === row.date);
  return {
    find(filter) {
      return new Query(rows().filter((r) => matches(r, filter)).map(clone));
    },
    async countDocuments(filter) {
      return rows().filter((r) => matches(r, filter)).length;
    },
    async updateOne(filter, update, options = {}) {
      if (db.failNextProductionWrite === "duplicate") {
        db.failNextProductionWrite = null;
        throw duplicate({ teamId: 1, date: 1 });
      }
      db.beforeProductionUpdate?.(filter);
      const found = rows().find((r) => matches(r, filter));
      const now = new Date();
      if (!found) {
        if (!options.upsert) return { matchedCount: 0, modifiedCount: 0, upsertedCount: 0 };
        const row = { _id: new mongoose.Types.ObjectId().toString(), ...clone(update.$setOnInsert ?? {}), createdAt: now, updatedAt: now };
        if (liveClash(row)) throw duplicate({ teamId: 1, date: 1 });
        db.production.set(row._id, row);
        return { matchedCount: 0, modifiedCount: 0, upsertedCount: 1 };
      }
      const next = { ...found, ...clone(update.$set ?? {}) };
      for (const [k, by] of Object.entries(update.$inc ?? {})) next[k] = (next[k] ?? 0) + by;
      for (const [k, v] of Object.entries(update.$push ?? {})) next[k] = [...(next[k] ?? []), clone(v)];
      if (liveClash(next)) throw duplicate({ teamId: 1, date: 1 });
      Object.assign(found, next, { updatedAt: now });
      return { matchedCount: 1, modifiedCount: 1, upsertedCount: 0 };
    },
  };
};
