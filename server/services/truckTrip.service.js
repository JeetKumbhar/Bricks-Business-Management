import { MATERIAL_RULES, MATERIAL_CATEGORY } from "../constants/truck.js";
import Truck from "../models/Truck.js";
import TruckTrip from "../models/TruckTrip.js";
import ApiError from "../utils/ApiError.js";
import { isFutureBusinessDate, todayBusinessDate } from "../utils/dates.js";
import { runInTransaction } from "../utils/transaction.js";
import { normalizeText, quantityError, resolveTripMaterial, textKey, truckNumberKey } from "../utils/truckRules.js";
import { summarizeTrips } from "./truckTripCalculations.js";

// Pheera (transport trips). Rules for this module:
//  - ONE record per trip. A batch of five rows creates five separate records; nothing is ever grouped.
//  - The server numbers them: per truck and business date, 1, 2, 3 ... in row order, independent for every truck, restarting each day.
//    Numbers are never reused (a voided Pheera keeps its number) and editing never changes one. A unique index
//    {truck, date, number} is the safety net; a save that loses a race with another save is retried with fresh numbers.
//  - A batch is validated as a whole and written in ONE transaction: all rows or none. Saving the same submissionId again returns
//    the records saved the first time instead of creating new ones.
//  - Material: Bricks (whole bricks), Soil (tonnes) or Other with its real name (tonnes). The unit always follows the material.
//    Older names (Sand, Cement, Stone ...) are ordinary Other records in tonnes and stay readable and editable.
//  - Corrections keep the old values (who, when, why). Delete is a soft delete ("void") with a reason. Voided records are left out
//    of every total. Totals are never stored.
//  - Pheera never read or write labour, attendance, payments or salary, and a truck's status never blocks a Pheera.

const MAX_ATTEMPTS = 3;
const fieldError = (status, message, field) => new ApiError(status, message, [{ field, message }]);
const isDuplicateKey = (err) => err?.code === 11000;
const live = { isDeleted: false };

// ---------- Output shapes (the frontend's own field names) ----------

const snapshotDto = (b) => ({ materialCategory: b.materialCategory, materialName: b.materialName, destination: b.destination, quantity: b.quantity, unit: b.unit, remarks: b.remarks ?? "" });

export const toTripDto = (row) => ({
  id: String(row._id),
  truckId: String(row.truckId),
  truckNumber: row.truckNumber,
  businessDate: row.businessDate,
  pheeraNo: row.pheeraNo,
  materialCategory: row.materialCategory,
  materialName: row.materialName,
  quantityLabel: MATERIAL_RULES[row.materialCategory]?.quantityLabel ?? "Weight (Tonnes)",
  destination: row.destination,
  quantity: row.quantity,
  unit: row.unit,
  remarks: row.remarks ?? "",
  revision: row.revision ?? 1,
  corrected: (row.history ?? []).some((h) => h.action === "CORRECT"),
  isVoided: Boolean(row.isDeleted),
  voidReason: row.isDeleted ? row.deletedReason : null,
  voidedAt: row.isDeleted ? row.deletedAt : null,
  voidedBy: row.isDeleted ? row.deletedBy : null,
  submissionId: row.submissionId ?? null,
  clientRowId: row.clientRowId ?? null,
  createdAt: row.createdAt,
  createdBy: row.createdByName ?? null,
  updatedAt: row.updatedAt,
  updatedBy: row.updatedByName ?? null,
});

const toDetailDto = (row) => ({
  ...toTripDto(row),
  audit: (row.history ?? []).map(({ action, revision, at, by, reason, before }) => ({ action, revision, at, by, reason, before: snapshotDto(before) })),
});

export const summaryDto = (rows) => summarizeTrips(rows);

// ---------- Filters (shared with the reports) ----------

/** "mh04" matches "MH-04-AB-1234": letters and digits in order with anything between them. Only A-Z0-9 reach the pattern, so it is safe. */
const registrationPattern = (text) => new RegExp([...truckNumberKey(text)].join("[^A-Z0-9]*"), "i");

export const buildTripFilter = ({ truckId, registration, material, materialName, destination, date, from, to, includeVoided = false } = {}) => ({
  ...(includeVoided ? {} : live),
  ...(truckId ? { truckId } : {}),
  ...(registration ? { truckNumber: truckNumberKey(registration) ? registrationPattern(registration) : { $in: [] } } : {}), // text with no letters or digits matches nothing
  ...(material ? { materialCategory: material } : {}),
  ...(materialName ? { materialKey: textKey(materialName) } : {}),
  ...(destination ? { destinationKey: textKey(destination) } : {}),
  ...(date ? { businessDate: date } : from || to ? { businessDate: { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) } } : {}),
});

// ---------- Reads ----------

/** Individual Pheera records, newest first, paged. `summary` covers every live record that matches, not only the page. */
export const listTrips = async (query) => {
  const { page = 1, limit = 100 } = query;
  const filter = buildTripFilter(query);
  const [total, rows, all] = await Promise.all([
    TruckTrip.countDocuments(filter),
    TruckTrip.find(filter).sort({ businessDate: -1, truckNumber: 1, pheeraNo: 1 }).skip((page - 1) * limit).limit(limit).lean(),
    TruckTrip.find({ ...filter, ...live }).lean(),
  ]);
  return { items: rows.map(toTripDto), page, limit, total, summary: summaryDto(all) };
};

/** The saved Pheera of one day (optionally one truck), in truck then Pheera order, with the day's totals. */
export const getDay = async ({ date, truckId, includeVoided = false }) => {
  const rows = (await TruckTrip.find(buildTripFilter({ date, truckId, includeVoided })).lean()).sort((a, b) => a.truckNumber.localeCompare(b.truckNumber) || a.pheeraNo - b.pheeraNo);
  return { date, items: rows.map(toTripDto), summary: summaryDto(rows.filter((r) => !r.isDeleted)) };
};

const loadTrip = async (id) => {
  const [row] = await TruckTrip.find({ _id: id }).lean();
  if (!row) throw ApiError.notFound("Pheera record not found");
  return row;
};

/** One record with its correction trail. */
export const getTrip = async (id) => toDetailDto(await loadTrip(id));

/** Values for the filter drop-downs: the standard materials plus every material and destination actually used. */
export const getOptions = async () => {
  const rows = await TruckTrip.find({ ...live }).lean();
  const materials = new Map([[textKey("Bricks"), { name: "Bricks", key: "bricks", category: MATERIAL_CATEGORY.BRICKS, unit: "bricks" }], [textKey("Soil"), { name: "Soil", key: "soil", category: MATERIAL_CATEGORY.SOIL, unit: "tonnes" }]]);
  const destinations = new Map();
  for (const r of rows) {
    if (!materials.has(r.materialKey)) materials.set(r.materialKey, { name: r.materialName, key: r.materialKey, category: r.materialCategory, unit: r.unit });
    if (!destinations.has(r.destinationKey)) destinations.set(r.destinationKey, { name: r.destination, key: r.destinationKey });
  }
  const sorted = (map) => [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  return { materials: sorted(materials), destinations: sorted(destinations) };
};

// ---------- Write: create (one or many) ----------

const rowErrorsOf = (resolved) => resolved.flatMap((r, i) => Object.entries(r.errors ?? {}).map(([field, message]) => ({ field: `trips.${i}.${field}`, message })));

/**
 * Saves each row as its OWN Pheera record, all together or none. rows: [{ material, customMaterialName?, destination, quantity,
 * unit?, remarks?, clientRowId? }]. Returns { records, duplicate }: duplicate is true when the same submissionId had already been saved.
 */
export const createTrips = async ({ truckId, businessDate, submissionId = null, rows }, actor, now = new Date()) => {
  if (isFutureBusinessDate(businessDate, now)) throw fieldError(400, `The date cannot be in the future (today is ${todayBusinessDate(now)})`, "businessDate");
  const [truck] = await Truck.find({ _id: truckId }).lean();
  if (!truck) throw fieldError(400, "Truck not found", "truckId");

  const resolved = rows.map((row) => resolveTripMaterial({ material: row.material, customMaterialName: row.customMaterialName ?? "", quantity: row.quantity, unit: row.unit }));
  const errors = rowErrorsOf(resolved);
  if (errors.length) throw ApiError.badRequest("Some rows cannot be saved. Nothing was saved.", errors);

  const actorId = actor.id ?? null;
  const build = (max) =>
    rows.map((row, i) => ({
      truckId,
      truckNumber: truck.truckNumber, // snapshot: reports keep the number even if the truck is corrected later
      businessDate,
      pheeraNo: max + 1 + i,
      ...resolved[i].value,
      destination: normalizeText(row.destination),
      destinationKey: textKey(row.destination),
      remarks: normalizeText(row.remarks),
      submissionId,
      clientRowId: submissionId ? (row.clientRowId ?? `row-${i}`) : (row.clientRowId ?? null),
      revision: 1,
      history: [],
      isDeleted: false,
      deletedAt: null,
      deletedBy: null,
      deletedReason: null,
      createdBy: actorId,
      createdByName: actor.name ?? null,
      updatedBy: actorId,
      updatedByName: actor.name ?? null,
    }));

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const result = await runInTransaction(async (session) => {
        if (submissionId) {
          const previous = await TruckTrip.find({ submissionId }).session(session).lean();
          if (previous.length) {
            if (String(previous[0].truckId) !== String(truckId) || previous[0].businessDate !== businessDate) {
              throw fieldError(409, "This submissionId was already used for a different truck or date", "submissionId");
            }
            return { records: previous.sort((a, b) => a.pheeraNo - b.pheeraNo), duplicate: true };
          }
        }
        // Voided Pheera count too, so a number is never reused.
        const existing = await TruckTrip.find({ truckId, businessDate }).session(session).lean();
        const max = existing.reduce((m, t) => Math.max(m, t.pheeraNo), 0);
        const created = await TruckTrip.insertMany(build(max), { session });
        return { records: created.map((d) => d.toObject()), duplicate: false };
      });
      return { records: result.records.map(toTripDto), duplicate: result.duplicate };
    } catch (err) {
      if (!isDuplicateKey(err)) throw err;
      // Another save took one of these numbers (or this submission) at the same moment: read again and number afresh.
      if (attempt === MAX_ATTEMPTS) throw ApiError.conflict("Another save for this truck and date happened at the same moment. Reload and try again.");
    }
  }
  throw ApiError.conflict("Could not save. Reload and try again."); // unreachable; keeps the function total
};

// ---------- Write: correct or void ----------

/**
 * Correct material / destination / quantity / remarks. The truck, date and Pheera number never change. If the material changes,
 * the quantity must be sent again and is checked against the NEW unit (a number is never reinterpreted in another unit).
 */
export const correctTrip = async (id, input, actor, now = new Date()) => {
  const trip = await loadTrip(id);
  if (trip.isDeleted) throw ApiError.conflict("A voided Pheera cannot be corrected");

  let material = { materialCategory: trip.materialCategory, materialName: trip.materialName, materialKey: trip.materialKey, unit: trip.unit };
  let materialChanged = false;
  if (input.material !== undefined) {
    const result = resolveTripMaterial({ material: input.material, customMaterialName: input.customMaterialName ?? "", quantity: input.quantity ?? 1, unit: input.unit });
    if (result.errors) throw ApiError.badRequest("Validation failed", Object.entries(result.errors).map(([field, message]) => ({ field, message })));
    const { quantity: _ignored, ...resolvedMaterial } = result.value;
    material = resolvedMaterial;
    materialChanged = material.materialCategory !== trip.materialCategory || material.materialKey !== trip.materialKey;
    if (materialChanged && input.quantity === undefined) throw fieldError(400, "Re-enter the quantity for the new material", "quantity");
  }
  if (input.unit !== undefined && input.unit !== material.unit) throw fieldError(400, `This material is counted in ${material.unit}`, "unit");

  const quantity = input.quantity ?? trip.quantity;
  if (input.quantity !== undefined || materialChanged) {
    const problem = quantityError(quantity, material.unit);
    if (problem) throw fieldError(400, problem, "quantity");
  }
  const destination = input.destination === undefined ? trip.destination : normalizeText(input.destination);
  const remarks = input.remarks === undefined ? trip.remarks ?? "" : normalizeText(input.remarks);

  const next = { ...material, quantity, destination, destinationKey: textKey(destination), remarks };
  const unchanged = ["materialCategory", "materialName", "quantity", "unit", "destination", "remarks"].every((k) => next[k] === (trip[k] ?? ""));
  if (unchanged) return toDetailDto(trip);

  const actorId = actor.id ?? null;
  const result = await TruckTrip.updateOne(
    { _id: trip._id, revision: trip.revision, ...live },
    {
      $set: { ...next, updatedBy: actorId, updatedByName: actor.name ?? null },
      $inc: { revision: 1 },
      $push: { history: { action: "CORRECT", revision: trip.revision, at: now, by: actor.name, byId: actorId, reason: input.reason, before: snapshotDto(trip) } },
    }
  );
  if (result.matchedCount !== 1) throw ApiError.conflict("This Pheera was changed by someone else. Reload and try again.");
  return getTrip(id);
};

/** Void (soft delete): the record stays with who, when and why, keeps its number, and is left out of every total. */
export const voidTrip = async (id, { reason }, actor, now = new Date()) => {
  const trip = await loadTrip(id);
  if (trip.isDeleted) throw ApiError.conflict("This Pheera is already voided");
  const actorId = actor.id ?? null;
  const result = await TruckTrip.updateOne(
    { _id: trip._id, revision: trip.revision, ...live },
    {
      $set: { isDeleted: true, deletedAt: now, deletedBy: actor.name, deletedReason: reason, updatedBy: actorId, updatedByName: actor.name ?? null },
      $inc: { revision: 1 },
      $push: { history: { action: "VOID", revision: trip.revision, at: now, by: actor.name, byId: actorId, reason, before: snapshotDto(trip) } },
    }
  );
  if (result.matchedCount !== 1) throw ApiError.conflict("This Pheera was changed by someone else. Reload and try again.");
  return getTrip(id);
};
