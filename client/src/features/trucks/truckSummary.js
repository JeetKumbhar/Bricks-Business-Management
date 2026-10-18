import { STOP_REASON_LABELS, STOP_REASONS, TRUCK_STATUS } from "../../utils/truckStatus";

export const summarizeTrucks = (trucks) => ({
  total: trucks.length,
  working: trucks.filter((t) => t.status === TRUCK_STATUS.WORKING).length,
  stopped: trucks.filter((t) => t.status === TRUCK_STATUS.STOPPED).length,
  maintenance: trucks.filter((t) => t.status === TRUCK_STATUS.MAINTENANCE).length,
});

/** Trucks that are not working, with the reason, for the Dashboard's "Needs attention" list. */
export const trucksNeedingAttention = (trucks, maintenance = []) =>
  trucks
    .filter((t) => t.status !== TRUCK_STATUS.WORKING)
    .map((t) => {
      let reason;
      if (t.status === TRUCK_STATUS.STOPPED) {
        reason = STOP_REASON_LABELS[t.stopReason] ?? "Stopped";
        if (t.stopReason === STOP_REASONS.OTHER && t.statusNote) reason = t.statusNote;
      } else {
        const open = maintenance.find((m) => m.truckId === t.id && m.status === "OPEN");
        reason = open?.description ?? (t.statusNote || "Maintenance");
      }
      return { id: t.id, truckNumber: t.truckNumber, status: t.status, reason, since: t.statusSince.slice(0, 10) };
    })
    .sort((a, b) => b.since.localeCompare(a.since));
