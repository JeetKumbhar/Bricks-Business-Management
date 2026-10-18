// Pure functions for trucks: add, change status, change driver, service records.
// Trucks are kept separate from labour earnings; nothing here touches attendance, work entries or payments.
import { TRUCK_STATUS, STOP_REASONS } from "../../utils/truckStatus";

const newId = (prefix) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

export const normalizeTruckNumber = (value) => String(value ?? "").trim().toUpperCase();

/** A new truck starts as Working, with a "Truck added" history entry. */
export const createTruck = ({ truckNumber, model = "", capacity = null, driverId = null }, { changedBy, now = new Date() }) => {
  const iso = now.toISOString();
  const truck = {
    id: newId("truck"),
    truckNumber: normalizeTruckNumber(truckNumber),
    model: model.trim(),
    capacity,
    driverId: driverId || null,
    status: TRUCK_STATUS.WORKING,
    statusSince: iso,
    stopReason: null,
    statusNote: "",
    createdAt: iso,
  };
  const historyEntry = { id: newId("th"), truckId: truck.id, kind: "CREATED", from: null, to: TRUCK_STATUS.WORKING, reason: null, note: "Truck added", changedBy, changedAt: iso };
  return { truck, historyEntry };
};

/** Rules for a status change. Returns an error message or null. */
export const checkStatusChange = (truck, input) => {
  if (!Object.values(TRUCK_STATUS).includes(input.status)) return "Choose a status";
  if (input.status === truck.status) return "Choose a different status";
  if (input.status === TRUCK_STATUS.STOPPED) {
    if (!Object.values(STOP_REASONS).includes(input.reason)) return "Choose why the truck stopped";
    if (input.reason === STOP_REASONS.OTHER && !(input.note ?? "").trim()) return "A note is required when the reason is Other";
  }
  if (input.status === TRUCK_STATUS.MAINTENANCE && (input.description ?? "").trim().length < 3) {
    return "Describe the maintenance work";
  }
  return null;
};

/**
 * Change a truck's status. Every change is a history entry (nothing is overwritten).
 * input: { status, reason, note, description, cost }
 *  - STOPPED needs a reason (BREAKDOWN, TYRE_PUNCTURE, DRIVER_ABSENT, OTHER + note)
 *  - MAINTENANCE opens a maintenance record
 *  - leaving MAINTENANCE completes the open record (with the cost, if given)
 * Returns { truck, historyEntry, addMaintenance, completeMaintenance: { truckId, date, cost } | null }
 */
export const applyStatusChange = ({ truck, input, changedBy, today, now = new Date() }) => {
  const problem = checkStatusChange(truck, input);
  if (problem) throw new Error(problem);

  const iso = now.toISOString();
  const stopped = input.status === TRUCK_STATUS.STOPPED;
  const reason = stopped ? input.reason : null;
  const note = (input.status === TRUCK_STATUS.MAINTENANCE ? input.description : input.note ?? "").trim();

  const historyEntry = {
    id: newId("th"),
    truckId: truck.id,
    kind: "STATUS",
    from: truck.status,
    to: input.status,
    reason,
    note,
    changedBy,
    changedAt: iso,
  };

  return {
    truck: { ...truck, status: input.status, statusSince: iso, stopReason: reason, statusNote: note },
    historyEntry,
    addMaintenance:
      input.status === TRUCK_STATUS.MAINTENANCE
        ? { id: newId("mt"), truckId: truck.id, date: today, description: input.description.trim(), cost: input.cost ?? null, status: "OPEN", completedDate: null }
        : null,
    completeMaintenance:
      truck.status === TRUCK_STATUS.MAINTENANCE ? { truckId: truck.id, date: today, cost: input.cost ?? null } : null,
  };
};

/** Changing the driver is recorded in the history. */
export const applyDriverChange = ({ truck, driverId, describe, changedBy, now = new Date() }) => ({
  truck: { ...truck, driverId: driverId || null },
  historyEntry: {
    id: newId("th"),
    truckId: truck.id,
    kind: "DRIVER",
    from: truck.status,
    to: truck.status,
    reason: null,
    note: describe,
    changedBy,
    changedAt: now.toISOString(),
  },
});

/** A past service (already done). */
export const createServiceRecord = ({ truckId, date, description, cost = null }) => ({
  id: newId("mt"),
  truckId,
  date,
  description: description.trim(),
  cost,
  status: "COMPLETED",
  completedDate: date,
});
