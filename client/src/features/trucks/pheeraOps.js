// Pure functions for Pheera (truck trips). No side effects, so they can move to the backend later.
//
// A Pheera record:
//   { id, businessDate "YYYY-MM-DD" (IST), truckId, truckRegistration (snapshot), pheeraNumber, material,
//     destination, quantity (number), unit "bricks" | "tonnes", remarks, batchId, createdAt (UTC ISO),
//     isDeleted, deletedReason?, deletedAt? }
//
// Numbering: Pheera numbers restart at 1 for each truck + date and continue after the HIGHEST number ever used
// (including deleted ones). Saved numbers are never changed, never reused and gaps are never filled.
import { unitForMaterial } from "../../utils/materials";

const newId = (now, i) => `pheera-${now.getTime().toString(36)}-${i}-${Math.random().toString(36).slice(2, 6)}`;

const sameDay = (r, truckId, date) => r.truckId === truckId && r.businessDate === date;

/** Records that count (deleted ones are kept in the store but hidden everywhere). */
export const activePheeras = (records) => records.filter((r) => !r.isDeleted);

/** Next Pheera number for a truck on a date. Looks at deleted records too, so numbers are never reused. */
export const nextPheeraNumber = (records, truckId, date) =>
  records.filter((r) => sameDay(r, truckId, date)).reduce((max, r) => Math.max(max, r.pheeraNumber), 0) + 1;

/** Missing numbers below the highest one (e.g. [3] when 1, 2, 4 exist). Shown as a hint, never auto-filled. */
export const numberingGaps = (records, truckId, date) => {
  const used = new Set(activePheeras(records).filter((r) => sameDay(r, truckId, date)).map((r) => r.pheeraNumber));
  const top = Math.max(0, ...used);
  const gaps = [];
  for (let n = 1; n < top; n += 1) if (!used.has(n)) gaps.push(n);
  return gaps;
};

/**
 * Turn validated rows into saved records with the next numbers for that truck + date.
 * `values` come from validateBatch(): [{ material, destination, quantity, unit, remarks }].
 */
export const buildPheeraRecords = ({ existing, truck, businessDate, values, batchId, now = new Date() }) => {
  const start = nextPheeraNumber(existing, truck.id, businessDate);
  return values.map((v, i) => ({
    id: newId(now, i),
    businessDate,
    truckId: truck.id,
    truckRegistration: truck.truckNumber,
    pheeraNumber: start + i,
    material: v.material,
    destination: v.destination,
    quantity: v.quantity,
    unit: v.unit ?? unitForMaterial(v.material),
    remarks: v.remarks ?? "",
    batchId,
    createdAt: now.toISOString(),
    isDeleted: false,
  }));
};

/** Soft delete. A reason is required; the record stays in the store and its number is never reused. */
export const markPheeraDeleted = (record, reason, now = new Date()) => {
  if (!String(reason ?? "").trim()) throw new Error("A reason is required to delete a Pheera");
  return { ...record, isDeleted: true, deletedReason: String(reason).trim(), deletedAt: now.toISOString() };
};
