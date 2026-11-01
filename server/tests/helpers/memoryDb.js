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
  counters: {},
  failNextRateCreate: false,
  reset() {
    this.labours.clear();
    this.rates.length = 0;
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
