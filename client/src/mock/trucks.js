// Truck mock data. Trucks are kept separate from labour earnings: a driver is only a link to a labour record.
//
// Truck:        { id, truckNumber, model, capacity (tons | null), driverId (labour id | null), status,
//                 statusSince (ISO), stopReason (when STOPPED), statusNote, createdAt }
// History:      { id, truckId, kind: CREATED | STATUS | DRIVER, from, to, reason, note, changedBy, changedAt (ISO) }
// Maintenance:  { id, truckId, date, description, cost (number | null), status: OPEN | COMPLETED, completedDate }
const ts = (daysAgo, hour = 10) => {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
};
const day = (daysAgo) => ts(daysAgo).slice(0, 10);

// [number, model, capacity, driverId, status, stopReason, statusDaysAgo, note]
const rows = [
  ["TRK-01", "Tata 407", 4, "L-001", "WORKING", null, 30, ""],
  ["TRK-02", "Eicher Pro", 6, "L-002", "STOPPED", "BREAKDOWN", 1, "Gearbox problem"],
  ["TRK-03", "Tata 407", 4, "L-003", "WORKING", null, 60, ""],
  ["TRK-04", "Ashok Leyland", 8, "L-004", "MAINTENANCE", null, 2, "Engine service"],
  ["TRK-05", "Mahindra Bolero Pickup", 2, "L-005", "WORKING", null, 45, ""],
  ["TRK-06", "Tata 407", 4, "L-006", "WORKING", null, 40, ""],
  ["TRK-07", "Eicher Pro", 6, "L-007", "STOPPED", "DRIVER_ABSENT", 0, ""],
  ["TRK-08", "Ashok Leyland", 8, "L-008", "WORKING", null, 25, ""],
  ["TRK-09", "Tata 407", 4, "L-010", "WORKING", null, 15, ""],
  ["TRK-10", "Mahindra Bolero Pickup", 2, null, "WORKING", null, 10, ""],
];

export const initialTrucks = rows.map(([truckNumber, model, capacity, driverId, status, stopReason, statusDaysAgo, statusNote], i) => ({
  id: `truck-${String(i + 1).padStart(2, "0")}`,
  truckNumber,
  model,
  capacity,
  driverId,
  status,
  statusSince: ts(statusDaysAgo, status === "WORKING" ? 9 : 11),
  stopReason,
  statusNote,
  createdAt: ts(120),
}));

const byNumber = Object.fromEntries(initialTrucks.map((t) => [t.truckNumber, t]));

export const initialTruckHistory = [
  // every truck starts as "added, working"
  ...initialTrucks.map((t) => ({
    id: `th-${t.id}-0`,
    truckId: t.id,
    kind: "CREATED",
    from: null,
    to: "WORKING",
    reason: null,
    note: "Truck added",
    changedBy: "Ramesh Patel",
    changedAt: t.createdAt,
  })),
  // earlier stop on TRK-01 that has been resolved
  { id: "th-t1-a", truckId: byNumber["TRK-01"].id, kind: "STATUS", from: "WORKING", to: "STOPPED", reason: "TYRE_PUNCTURE", note: "Rear tyre", changedBy: "Ramesh Patel", changedAt: ts(31, 14) },
  { id: "th-t1-b", truckId: byNumber["TRK-01"].id, kind: "STATUS", from: "STOPPED", to: "WORKING", reason: null, note: "Tyre replaced", changedBy: "Ramesh Patel", changedAt: ts(30, 9) },
  // the current non-working trucks
  { id: "th-t2", truckId: byNumber["TRK-02"].id, kind: "STATUS", from: "WORKING", to: "STOPPED", reason: "BREAKDOWN", note: "Gearbox problem", changedBy: "Ramesh Patel", changedAt: byNumber["TRK-02"].statusSince },
  { id: "th-t4", truckId: byNumber["TRK-04"].id, kind: "STATUS", from: "WORKING", to: "MAINTENANCE", reason: null, note: "Engine service", changedBy: "Ramesh Patel", changedAt: byNumber["TRK-04"].statusSince },
  { id: "th-t7", truckId: byNumber["TRK-07"].id, kind: "STATUS", from: "WORKING", to: "STOPPED", reason: "DRIVER_ABSENT", note: "", changedBy: "Ramesh Patel", changedAt: byNumber["TRK-07"].statusSince },
];

export const initialMaintenance = [
  { id: "mt-1", truckId: byNumber["TRK-04"].id, date: day(2), description: "Engine service", cost: null, status: "OPEN", completedDate: null },
  { id: "mt-2", truckId: byNumber["TRK-01"].id, date: day(30), description: "Tyre replacement", cost: 8500, status: "COMPLETED", completedDate: day(30) },
  { id: "mt-3", truckId: byNumber["TRK-05"].id, date: day(45), description: "Oil change", cost: 1800, status: "COMPLETED", completedDate: day(45) },
];
