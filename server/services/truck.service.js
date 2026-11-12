import { LABOUR_STATUS, LABOUR_TYPES } from "../constants/labour.js";
import { HISTORY_KINDS, STOP_REASONS, TRUCK_STATUS } from "../constants/truck.js";
import Labour from "../models/Labour.js";
import Truck from "../models/Truck.js";
import TruckStatusHistory from "../models/TruckStatusHistory.js";
import ApiError from "../utils/ApiError.js";
import { runInTransaction } from "../utils/transaction.js";
import { normalizeText, normalizeTruckNumber, truckNumberKey } from "../utils/truckRules.js";

// Trucks: the operational master list. Rules for this module:
//  - A truck is never deleted (Pheera records and history refer to it). There is no delete.
//  - The registration number is unique ignoring case, spaces and hyphens (truckKey).
//  - Status changes only through changeStatus. Stopped needs a reason (Other also a note); Maintenance needs a description;
//    choosing the status the truck already has is refused. Going back to Working clears the CURRENT reason and note, but the
//    history row for every change is kept forever.
//  - A truck's status never changes or blocks its Pheera records, and nothing here touches labour, attendance, payments or salary.
//  - Writes that touch more than one document (truck + history row) run in one transaction.

const fieldError = (status, message, field) => new ApiError(status, message, [{ field, message }]);
const isDuplicateKey = (err) => err?.code === 11000;

export const toTruckDto = (row) => ({
  id: String(row.id ?? row._id),
  truckNumber: row.truckNumber,
  nickname: row.nickname ?? "",
  model: row.model ?? "",
  capacity: row.capacity ?? null,
  driverId: row.driverId ?? null,
  status: row.status,
  statusSince: row.statusSince,
  stopReason: row.stopReason ?? null,
  statusNote: row.statusNote ?? "",
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

export const toHistoryDto = (row) => ({
  id: String(row.id ?? row._id),
  truckId: String(row.truckId),
  kind: row.kind,
  from: row.from ?? null,
  to: row.to ?? null,
  reason: row.reason ?? null,
  note: row.note ?? "",
  previousDriverId: row.previousDriverId ?? null,
  newDriverId: row.newDriverId ?? null,
  changedBy: row.changedBy,
  changedAt: row.changedAt,
});

const loadTruck = async (id) => {
  const [row] = await Truck.find({ _id: id }).lean();
  if (!row) throw ApiError.notFound("Truck not found");
  return row;
};

/** A driver must be an active Bigari or Maapvali worker (a Patlavale team is a family, not a person). */
const assertEligibleDriver = async (driverId) => {
  const [labour] = await Labour.find({ _id: driverId }).lean();
  if (!labour) throw fieldError(400, "Driver not found", "driverId");
  const eligible = labour.status === LABOUR_STATUS.ACTIVE && (labour.labourType === LABOUR_TYPES.BIGARI || labour.labourType === LABOUR_TYPES.MAAPVALI);
  if (!eligible) throw fieldError(400, "A driver must be an active Bigari or Maapvali worker", "driverId");
  return labour;
};

const assertNumberFree = async (truckNumber, exceptId = null) => {
  const clash = (await Truck.find({ truckKey: truckNumberKey(truckNumber) }).lean()).find((t) => String(t._id) !== String(exceptId));
  if (clash) throw fieldError(409, `A truck with registration number ${clash.truckNumber} already exists`, "truckNumber");
};

const historyRow = (truckId, actor, now, fields) => ({ truckId, changedBy: actor.name ?? null, changedById: actor.id ?? null, changedAt: now, ...fields });

// ---------- Reads ----------

/** All trucks (optionally one status and/or a search), by registration number, with fleet counts that ignore the filter. */
export const listTrucks = async ({ status, search } = {}) => {
  const all = (await Truck.find({}).lean()).sort((a, b) => a.truckNumber.localeCompare(b.truckNumber));
  const q = normalizeText(search).toLowerCase();
  const rows = all.filter((t) => (!status || t.status === status) && (!q || [t.truckNumber, t.nickname, t.model].some((v) => String(v ?? "").toLowerCase().includes(q))));
  const count = (s) => all.filter((t) => t.status === s).length;
  return {
    items: rows.map(toTruckDto),
    counts: { total: all.length, working: count(TRUCK_STATUS.WORKING), stopped: count(TRUCK_STATUS.STOPPED), maintenance: count(TRUCK_STATUS.MAINTENANCE) },
  };
};

export const getTruck = async (id) => toTruckDto(await loadTruck(id));

/** Every change to the truck, newest first. Never shortened when the truck returns to Working. */
export const getHistory = async (id) => {
  await loadTruck(id);
  return (await TruckStatusHistory.find({ truckId: id }).lean()).sort((a, b) => new Date(b.changedAt) - new Date(a.changedAt) || String(b._id).localeCompare(String(a._id))).map(toHistoryDto);
};

// ---------- Writes ----------

/** A new truck starts as Working, with a "Truck added" history row. */
export const createTruck = async (input, actor, now = new Date()) => {
  const truckNumber = normalizeTruckNumber(input.truckNumber);
  await assertNumberFree(truckNumber);
  if (input.driverId) await assertEligibleDriver(input.driverId);
  const actorId = actor.id ?? null;
  try {
    const row = await runInTransaction(async (session) => {
      const [created] = await Truck.insertMany(
        [
          {
            truckNumber,
            truckKey: truckNumberKey(truckNumber),
            nickname: normalizeText(input.nickname),
            model: normalizeText(input.model),
            capacity: input.capacity ?? null,
            driverId: input.driverId ?? null,
            status: TRUCK_STATUS.WORKING,
            statusSince: now,
            stopReason: null,
            statusNote: "",
            createdBy: actorId,
            updatedBy: actorId,
          },
        ],
        { session }
      );
      await TruckStatusHistory.insertMany([historyRow(created._id, actor, now, { kind: HISTORY_KINDS.CREATED, from: null, to: TRUCK_STATUS.WORKING, note: "Truck added" })], { session });
      return created.toObject({ transform: false });
    });
    return toTruckDto(row);
  } catch (err) {
    if (isDuplicateKey(err)) throw fieldError(409, "A truck with this registration number already exists", "truckNumber");
    throw err;
  }
};

/** Update registration, nickname, model, capacity or driver. A driver change is recorded in the history. Status is not changed here. */
export const updateTruck = async (id, changes, actor, now = new Date()) => {
  const truck = await loadTruck(id);
  const set = {};
  if (changes.truckNumber !== undefined) {
    const truckNumber = normalizeTruckNumber(changes.truckNumber);
    await assertNumberFree(truckNumber, truck._id);
    Object.assign(set, { truckNumber, truckKey: truckNumberKey(truckNumber) });
  }
  if (changes.nickname !== undefined) set.nickname = normalizeText(changes.nickname);
  if (changes.model !== undefined) set.model = normalizeText(changes.model);
  if (changes.capacity !== undefined) set.capacity = changes.capacity;

  const driverChanged = changes.driverId !== undefined && (changes.driverId ?? null) !== (truck.driverId ?? null);
  let driverNote = "";
  if (driverChanged) {
    if (changes.driverId) await assertEligibleDriver(changes.driverId);
    const names = new Map((await Labour.find({ _id: { $in: [truck.driverId, changes.driverId].filter(Boolean) } }).lean()).map((l) => [String(l._id), l.name]));
    const label = (driverId) => (driverId ? `${names.get(driverId) ?? driverId} (${driverId})` : "no driver");
    driverNote = `Driver changed from ${label(truck.driverId)} to ${label(changes.driverId)}`;
    set.driverId = changes.driverId ?? null;
  }

  set.updatedBy = actor.id ?? null;
  try {
    await runInTransaction(async (session) => {
      await Truck.updateOne({ _id: truck._id }, { $set: set }, { session });
      if (driverChanged) {
        await TruckStatusHistory.insertMany(
          [historyRow(truck._id, actor, now, { kind: HISTORY_KINDS.DRIVER, from: truck.status, to: truck.status, note: driverNote, previousDriverId: truck.driverId ?? null, newDriverId: changes.driverId ?? null })],
          { session }
        );
      }
    });
  } catch (err) {
    if (isDuplicateKey(err)) throw fieldError(409, "A truck with this registration number already exists", "truckNumber");
    throw err;
  }
  return getTruck(id);
};

/**
 * Change the status. Returns the updated truck and the history row. A repeated identical request is refused (the truck
 * already has that status), and two people changing it at once cannot both win: the update only applies if the status is
 * still what we read.
 */
export const changeStatus = async (id, input, actor, now = new Date()) => {
  const truck = await loadTruck(id);
  if (input.status === truck.status) throw fieldError(409, `The truck is already ${truck.status.toLowerCase()}`, "status");

  const stopped = input.status === TRUCK_STATUS.STOPPED;
  const reason = stopped ? input.reason : null;
  if (stopped && !reason) throw fieldError(400, "Choose why the truck stopped", "reason");
  if (stopped && reason === STOP_REASONS.OTHER && !normalizeText(input.note)) throw fieldError(400, "A note is required when the reason is Other", "note");
  if (input.status === TRUCK_STATUS.MAINTENANCE && normalizeText(input.description).length < 3) throw fieldError(400, "Describe the maintenance work", "description");
  const note = input.status === TRUCK_STATUS.MAINTENANCE ? normalizeText(input.description) : normalizeText(input.note);

  const entry = await runInTransaction(async (session) => {
    const result = await Truck.updateOne(
      { _id: truck._id, status: truck.status },
      // Working again clears the CURRENT reason and note; the history row below keeps what was true before.
      { $set: { status: input.status, statusSince: now, stopReason: reason, statusNote: input.status === TRUCK_STATUS.WORKING ? "" : note, updatedBy: actor.id ?? null } },
      { session }
    );
    if (result.matchedCount !== 1) throw ApiError.conflict("The truck's status was changed by someone else. Reload and try again.");
    const [created] = await TruckStatusHistory.insertMany([historyRow(truck._id, actor, now, { kind: HISTORY_KINDS.STATUS, from: truck.status, to: input.status, reason, note })], { session });
    return created.toObject({ transform: false });
  });
  return { truck: await getTruck(id), historyEntry: toHistoryDto(entry) };
};
