import { LABOUR_ID_PATTERN, LABOUR_STATUS, LABOUR_TYPES, LABOUR_TYPE_META, LABOUR_TYPE_VALUES } from "../constants/labour.js";
import { PAYMENT_TYPES } from "../constants/payments.js";
import Attendance from "../models/Attendance.js";
import Counter from "../models/Counter.js";
import Labour from "../models/Labour.js";
import LabourRateHistory from "../models/LabourRateHistory.js";
import MaapEntry from "../models/MaapEntry.js";
import Payment from "../models/Payment.js";
import ProductionEntry from "../models/ProductionEntry.js";
import ApiError from "../utils/ApiError.js";
import { runInTransaction } from "../utils/transaction.js";
import { addDays, todayBusinessDate } from "../utils/dates.js";
import { paiseToRupees, parseRupeesInput } from "../utils/money.js";
import { ratePaiseAt, sortRatesAsc } from "./labourRates.js";

// Labour = one salary account (an individual worker, or a whole Patlavale team). Rules for this module:
//  - Records are never deleted. "Remove" means status INACTIVE, with the reason and the person kept in statusHistory.
//  - The type and the rate are fixed at creation. The rate only changes by ADDING a rate-history row.
//  - Money is stored as paise and shown to the API caller in rupees under the frontend's own field names.

const LABOUR_COUNTER = "labour";
const formatLabourId = (n) => `L-${String(n).padStart(3, "0")}`;

const notFound = () => ApiError.notFound("Labour not found");
const fieldError = (status, message, field) => new ApiError(status, message, [{ field, message }]);
// Mobile numbers are optional and shared, so a duplicate-key error can now only mean something else: the worker id, or an OLD database that
// still has the unique mobile index (it must be dropped; see the release notes). Neither is the Owner's mistake, and both are said plainly.
const duplicateKeyProblem = (err) =>
  /mobile/.test(JSON.stringify(err?.keyPattern ?? err?.message ?? ""))
    ? fieldError(409, "The database still enforces the old one-worker-per-mobile-number rule, so this worker cannot be saved yet. Ask your administrator to remove that index.", "mobile")
    : ApiError.conflict("Could not save the worker (the worker id was taken at the same moment). Please try again.");
const isDuplicateKey = (err) => err?.code === 11000;

/** "L-001", "L-002", ... never reused: the counter only goes up, even if the save that follows fails. */
export const nextLabourId = async () => {
  const counter = await Counter.findOneAndUpdate({ _id: LABOUR_COUNTER }, { $inc: { seq: 1 } }, { new: true, upsert: true, setDefaultsOnInsert: true });
  return formatLabourId(counter.seq);
};

// ---------- Output shapes (what the frontend already reads) ----------

const toRateDto = (row) => ({
  id: String(row._id),
  labourId: row.labourId,
  rateType: row.rateType,
  rate: paiseToRupees(row.ratePaise),
  effectiveFrom: row.effectiveFrom,
  reason: row.reason,
  changedBy: row.changedBy,
  createdAt: row.createdAt,
});

/** A labour as the frontend stores it: only the rate field of its own type, plus rateType. `historyAsc` sorted oldest first. */
export const toLabourDto = (labour, historyAsc = [], today = todayBusinessDate()) => {
  const meta = LABOUR_TYPE_META[labour.labourType];
  const currentPaise = ratePaiseAt(historyAsc, today);
  return {
    id: String(labour._id),
    labourType: labour.labourType,
    name: labour.name,
    mobile: labour.mobile ?? null,
    village: labour.village,
    joiningDate: labour.joiningDate,
    status: labour.status,
    rateType: meta.rateType,
    [meta.rateField]: currentPaise === null ? null : paiseToRupees(currentPaise),
    ...(labour.members?.length ? { members: labour.members.map(({ name, relation }) => ({ name, ...(relation ? { relation } : {}) })) } : {}),
    statusHistory: (labour.statusHistory ?? []).map(({ status, at, by, reason }) => ({ status, at, by, reason: reason ?? null })),
    createdAt: labour.createdAt,
    updatedAt: labour.updatedAt,
  };
};

const loadHistoryAsc = async (labourIds) => {
  const rows = await LabourRateHistory.find({ labourId: { $in: labourIds } }).lean();
  const byLabour = new Map();
  for (const row of rows) {
    if (!byLabour.has(row.labourId)) byLabour.set(row.labourId, []);
    byLabour.get(row.labourId).push(row);
  }
  for (const [id, list] of byLabour) byLabour.set(id, sortRatesAsc(list));
  return byLabour;
};

// ---------- Search and filters ----------

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Mongo filter for the list. `search` matches name (team name for Patlavale), mobile, labour id, or a type name
 * ("patlavale" finds every team), exactly like the frontend's filterLabours. The text is escaped, so it is never a pattern.
 */
export const buildListFilter = ({ type = "ALL", status = "ALL", search = "" } = {}, today = todayBusinessDate()) => {
  const and = [];
  if (type !== "ALL") and.push({ labourType: type });
  if (status === "NEW") and.push({ joiningDate: new RegExp(`^${today.slice(0, 7)}-`) });
  else if (status !== "ALL") and.push({ status });

  const text = search.trim();
  if (text) {
    const pattern = new RegExp(escapeRegex(text), "i");
    const typesByName = LABOUR_TYPE_VALUES.filter((t) => LABOUR_TYPE_META[t].label.toLowerCase().includes(text.toLowerCase()));
    and.push({ $or: [{ name: pattern }, { mobile: pattern }, { _id: pattern }, ...(typesByName.length ? [{ labourType: { $in: typesByName } }] : [])] });
  }
  return and.length ? { $and: and } : {};
};

// ---------- Reads ----------

export const listLabours = async (query = {}) => {
  const page = query.page ?? 1;
  const limit = query.limit ?? 200;
  const filter = buildListFilter(query);

  const [total, labours] = await Promise.all([
    Labour.countDocuments(filter),
    Labour.find(filter).sort({ createdAt: 1, _id: 1 }).skip((page - 1) * limit).limit(limit).lean(),
  ]);
  const history = await loadHistoryAsc(labours.map((l) => String(l._id)));
  const today = todayBusinessDate();
  return { items: labours.map((l) => toLabourDto(l, history.get(String(l._id)), today)), page, limit, total };
};

/** Same numbers as the frontend's getLabourCounts. Counts everything, ignoring filters. */
export const getLabourSummary = async () => {
  const rows = await Labour.find({}, "labourType status joiningDate").lean();
  const month = todayBusinessDate().slice(0, 7);
  const countType = (type) => rows.filter((r) => r.labourType === type).length;
  return {
    total: rows.length,
    active: rows.filter((r) => r.status === LABOUR_STATUS.ACTIVE).length,
    inactive: rows.filter((r) => r.status === LABOUR_STATUS.INACTIVE).length,
    newThisMonth: rows.filter((r) => r.joiningDate?.startsWith(`${month}-`)).length,
    bigari: countType(LABOUR_TYPES.BIGARI),
    maapvali: countType(LABOUR_TYPES.MAAPVALI),
    patlavale: countType(LABOUR_TYPES.PATLAVALE),
  };
};

const findLabourOrThrow = async (id) => {
  if (!LABOUR_ID_PATTERN.test(String(id))) throw notFound();
  const labour = await Labour.findById(id);
  if (!labour) throw notFound();
  return labour;
};

export const getLabour = async (id) => {
  const labour = await findLabourOrThrow(id);
  const history = await loadHistoryAsc([String(labour._id)]);
  return toLabourDto(labour, history.get(String(labour._id)));
};

/** Newest first, like the profile's Rate History tab. */
export const listRateHistory = async (id) => {
  const labour = await findLabourOrThrow(id);
  const rows = sortRatesAsc(await LabourRateHistory.find({ labourId: String(labour._id) }).lean());
  return rows.reverse().map(toRateDto);
};

// ---------- Writes ----------

export const createLabour = async (input, actor) => {
  const meta = LABOUR_TYPE_META[input.labourType];
  const ratePaise = parseRupeesInput(input[meta.rateField], meta.rateField);
  if (ratePaise < 1) throw fieldError(400, "Rate must be greater than 0", meta.rateField);

  const id = await nextLabourId();
  // The worker and the first rate are saved TOGETHER or not at all (one transaction). The id above is taken beforehand, so a failed
  // attempt can leave a gap in the numbering, exactly as before; no half-created worker can remain.
  await runInTransaction(
    async (session) => {
      try {
        await Labour.create(
          [
            {
              _id: id,
              labourType: input.labourType,
              name: input.name,
              mobile: input.mobile ?? null,
              village: input.village,
              joiningDate: input.joiningDate,
              status: input.status,
              ...(input.members?.length ? { members: input.members } : {}),
              statusHistory: [{ status: input.status, at: new Date(), by: actor.name, reason: "Created" }],
              createdBy: actor.id ?? null,
            },
          ],
          { session }
        );
      } catch (err) {
        if (isDuplicateKey(err)) throw duplicateKeyProblem(err);
        throw err;
      }
      await LabourRateHistory.create(
        [
          {
            labourId: id,
            rateType: meta.rateType,
            ratePaise,
            effectiveFrom: input.joiningDate,
            reason: "Initial rate",
            changedBy: actor.name,
            changedById: actor.id ?? null,
          },
        ],
        { session }
      );
    },
    { required: true }
  );
  return getLabour(id);
};

/**
 * Phase 1C (D1): the earliest existing record dated before `joiningDate`, or null. Read-only. Bayana (BOOKING_ADVANCE) may be
 * dated before joining, so it never conflicts. Deleted payments / entries are ignored, as everywhere else.
 */
const earliestRecordBefore = async (labourId, joiningDate) => {
  const lastAllowedDay = addDays(joiningDate, -1); // dates are YYYY-MM-DD strings: "before" == "on or before the day before"
  const first = (model, filter) => model.find(filter).sort({ date: 1 }).limit(1).lean();
  const groups = await Promise.all([
    first(Attendance, { labourId, date: { $lte: lastAllowedDay } }),
    first(MaapEntry, { labourId, isDeleted: false, date: { $lte: lastAllowedDay } }),
    first(ProductionEntry, { teamId: labourId, isDeleted: false, date: { $lte: lastAllowedDay } }),
    first(Payment, { recipientId: labourId, isDeleted: false, type: { $ne: PAYMENT_TYPES.BOOKING_ADVANCE }, date: { $lte: lastAllowedDay } }),
  ]);
  const labels = ["attendance", "Maapvali entry", "Patlavale production entry", "payment"];
  const hits = groups.map((rows, i) => (rows[0] ? { date: rows[0].date, label: labels[i] } : null)).filter(Boolean);
  return hits.sort((a, b) => a.date.localeCompare(b.date))[0] ?? null;
};

export const updateLabour = async (id, changes, actor) => {
  const labour = await findLabourOrThrow(id);
  const isTeam = LABOUR_TYPE_META[labour.labourType].isTeam;

  if (changes.members !== undefined && !isTeam) throw fieldError(400, "Members can only be listed for a Patlavale team", "members");

  // The first rate row starts on the joining date, so moving the joining date moves it too. It may not reach a later
  // rate change, or the order of the history would change. (Attendance and work entries are checked in their own phases.)
  let firstRate = null;
  if (changes.joiningDate !== undefined && changes.joiningDate !== labour.joiningDate) {
    const conflict = await earliestRecordBefore(String(labour._id), changes.joiningDate);
    if (conflict) {
      throw fieldError(409, `Joining date cannot be after existing records: the earliest is ${conflict.label} dated ${conflict.date}`, "joiningDate");
    }
    const history = sortRatesAsc(await LabourRateHistory.find({ labourId: String(labour._id) }).lean());
    const second = history[1];
    if (second && changes.joiningDate >= second.effectiveFrom) {
      throw fieldError(409, `Joining date must be before the first rate change (${second.effectiveFrom})`, "joiningDate");
    }
    firstRate = history[0] ?? null;
  }

  for (const field of ["name", "mobile", "village", "joiningDate", "members"]) {
    if (changes[field] !== undefined) labour[field] = changes[field];
  }
  if (changes.status !== undefined && changes.status !== labour.status) {
    labour.status = changes.status;
    labour.statusHistory.push({ status: changes.status, at: new Date(), by: actor.name, reason: changes.statusReason ?? null });
  }

  const saveLabour = async (session) => {
    try {
      await labour.save(session ? { session } : undefined);
    } catch (err) {
      if (isDuplicateKey(err)) throw duplicateKeyProblem(err);
      throw err;
    }
  };

  if (firstRate && changes.joiningDate !== undefined) {
    // Two documents change together (the worker and the first rate that starts on the joining date): saved TOGETHER or not at
    // all, in one transaction. On a database without transactions nothing is written and the caller gets a clear 503.
    // (An update that does not move the joining date changes one document only, which is already atomic, so it needs none.)
    await runInTransaction(
      async (session) => {
        await saveLabour(session);
        await LabourRateHistory.updateOne({ _id: firstRate._id }, { $set: { effectiveFrom: changes.joiningDate } }, { session });
      },
      { required: true }
    );
  } else {
    await saveLabour(null);
  }
  return getLabour(id);
};

/** Adds a rate-history row. Earlier rows and everything priced with them are never touched. */
export const changeRate = async (id, { newRate, effectiveFrom, reason }, actor) => {
  const labour = await findLabourOrThrow(id);
  const meta = LABOUR_TYPE_META[labour.labourType];
  const ratePaise = parseRupeesInput(newRate, "newRate");
  if (ratePaise < 1) throw fieldError(400, "Rate must be greater than 0", "newRate");

  const history = sortRatesAsc(await LabourRateHistory.find({ labourId: String(labour._id) }).lean());
  const latest = history.at(-1);
  if (latest) {
    if (effectiveFrom <= latest.effectiveFrom) {
      throw fieldError(400, `Must be after the previous rate change (${latest.effectiveFrom})`, "effectiveFrom");
    }
    if (ratePaise === latest.ratePaise) throw fieldError(400, "New rate must be different from the current rate", "newRate");
  }

  let row;
  try {
    row = await LabourRateHistory.create({
      labourId: String(labour._id),
      rateType: meta.rateType,
      ratePaise,
      effectiveFrom,
      reason,
      changedBy: actor.name,
      changedById: actor.id ?? null,
    });
  } catch (err) {
    if (isDuplicateKey(err)) throw fieldError(409, "A rate change already starts on that date", "effectiveFrom");
    throw err;
  }
  // transform:false keeps _id, which the response shape needs (the default transform renames it).
  return { rate: toRateDto(row.toObject({ transform: false })), labour: await getLabour(id) };
};
