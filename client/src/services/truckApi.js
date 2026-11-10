// Trucks: /api/trucks (server/routes/truck.routes.js, validators/truck.validators.js, services/truck.service.js).
// The server has NO delete, NO pagination (the whole list is returned, with counts) and NO maintenance / service-record endpoints, so
// none of those exist here. A truck's driver is a REAL labour id (Bigari or Maapvali). Writes are owner only on the server.
import { api } from "./api";

/** The truck shape the screens already use (same names as the server's DTO); missing values made safe. */
export const fromTruckDto = (dto) => ({
  ...dto,
  nickname: dto.nickname ?? "",
  model: dto.model ?? "",
  capacity: dto.capacity ?? null,
  driverId: dto.driverId ?? null,
  stopReason: dto.stopReason ?? null,
  statusNote: dto.statusNote ?? "",
});

export const fromHistoryDto = (dto) => ({ ...dto, from: dto.from ?? null, to: dto.to ?? null, reason: dto.reason ?? null, note: dto.note ?? "", previousDriverId: dto.previousDriverId ?? null, newDriverId: dto.newDriverId ?? null });

const textOrUndefined = (v) => (v === undefined || v === null ? undefined : String(v).trim());
/** "" and null -> null (no capacity); anything else must be a number (the server wants a JSON number, never text). */
const capacityOf = (v) => {
  if (v === undefined) return undefined;
  if (v === null || String(v).trim() === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error("Capacity must be a number");
  return n;
};
const driverOf = (v) => (v === undefined ? undefined : v ? String(v) : null);

/** Form values -> POST /trucks body. Only fields the server accepts are sent (never status or id). */
export const toCreateTruckBody = (values) => {
  const body = { truckNumber: textOrUndefined(values.truckNumber) };
  for (const [field, value] of [["nickname", textOrUndefined(values.nickname)], ["model", textOrUndefined(values.model)], ["capacity", capacityOf(values.capacity)], ["driverId", driverOf(values.driverId)]]) {
    if (value !== undefined) body[field] = value;
  }
  return body;
};

/** Only the fields that really changed (the server refuses an empty update). */
export const toUpdateTruckBody = (current, changes) => {
  const next = { truckNumber: textOrUndefined(changes.truckNumber), nickname: textOrUndefined(changes.nickname), model: textOrUndefined(changes.model), capacity: capacityOf(changes.capacity), driverId: driverOf(changes.driverId) };
  const body = {};
  for (const [field, value] of Object.entries(next)) {
    if (value !== undefined && value !== (current[field] ?? (field === "capacity" || field === "driverId" ? null : ""))) body[field] = value;
  }
  return body;
};

/**
 * Body of POST /trucks/:id/status. Stopped carries a reason (and a note, required for OTHER); Maintenance carries a description.
 * The screens' old "cost" field is NOT sent: the server has no place for it and rejects unknown fields.
 */
export const toStatusChangeBody = (input) => {
  const body = { status: input.status };
  if (input.status === "STOPPED") body.reason = input.reason;
  // a note is accepted with Working and Stopped (the form offers it for both), so what the user typed is never dropped
  if (input.status !== "MAINTENANCE") {
    const note = textOrUndefined(input.note);
    if (note) body.note = note;
  }
  if (input.status === "MAINTENANCE") body.description = textOrUndefined(input.description);
  return body;
};

// ---- Reads ---------------------------------------------------------------------------------------------------------

/** -> { items, counts: { total, working, stopped, maintenance } }. Filters: status (WORKING | STOPPED | MAINTENANCE), search. */
export async function listTrucks({ status, search } = {}, { signal } = {}) {
  const res = await api.get("/trucks", { query: { status, search }, signal });
  return { items: res.data.map(fromTruckDto), counts: res.meta?.counts ?? null };
}
export const getTruck = async (id, { signal } = {}) => fromTruckDto((await api.get(`/trucks/${id}`, { signal })).data);
/** Every change to the truck, newest first. */
export const getTruckHistory = async (id, { signal } = {}) => (await api.get(`/trucks/${id}/history`, { signal })).data.map(fromHistoryDto);

// ---- Writes (owner only on the server) -----------------------------------------------------------------------------

export const createTruck = async (values) => fromTruckDto((await api.post("/trucks", toCreateTruckBody(values))).data);

/** Throws before any request when nothing changed. */
export async function updateTruck(current, changes) {
  const body = toUpdateTruckBody(current, changes);
  if (Object.keys(body).length === 0) throw new Error("Nothing was changed");
  return fromTruckDto((await api.patch(`/trucks/${current.id}`, body)).data);
}

/** -> { truck, historyEntry } (the server records every status change in the truck's history). */
export async function changeTruckStatus(id, input) {
  const res = await api.post(`/trucks/${id}/status`, toStatusChangeBody(input));
  return { truck: fromTruckDto(res.data), historyEntry: res.meta?.historyEntry ? fromHistoryDto(res.meta.historyEntry) : null };
}
