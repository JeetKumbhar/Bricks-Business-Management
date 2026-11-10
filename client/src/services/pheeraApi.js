// Pheera (truck trips): /api/truck-trips (server/routes/truckTrip.routes.js, controllers/truckTrip.controller.js,
// validators/truckTrip.validators.js). Responses are mapped with pheeraMapper.js. A failed call always throws (an ApiError): there is
// never a fallback to sample data. Writes are owner only on the server.
//
// Batch saves are all-or-nothing on the server and idempotent by `submissionId`: after a lost connection, call again with the SAME
// submissionId and the server answers "already saved" (duplicate: true) instead of saving twice.
import { api } from "./api";
import { fetchAllPages } from "./labourApi";
import { fromPheeraDto, newSubmissionId, toBatchBody, toCorrectionBody, toListQuery, toSingleBody } from "./pheeraMapper";

// ---- Reads ---------------------------------------------------------------------------------------------------------

/** One page (<= 500): -> { items, meta: { page, limit, total, summary } }. Voided records only with includeVoided. */
export async function listPheeras(filters = {}, { page = 1, limit = 100, signal } = {}) {
  const res = await api.get("/truck-trips", { query: { ...toListQuery(filters), page, limit }, signal });
  return { items: res.data.map(fromPheeraDto), meta: res.meta ?? {} };
}

/** Every record matching the filters, read page by page and checked against the server's total (throws instead of returning a partial list). */
export async function fetchAllPheeras(filters = {}, { signal } = {}) {
  return (await fetchAllPages("/truck-trips", toListQuery(filters), { signal })).map(fromPheeraDto);
}

/** Pheeras still waiting for an invoice: UNBILLED, normal customers only (the server never returns Internal / No Bill, reserved, billed or historical ones). */
export const fetchBillablePheeras = ({ customerId } = {}, { signal } = {}) => fetchAllPheeras({ billable: true, customerId }, { signal });

/** One day: -> { date, items, summary }. */
export async function getPheeraDay({ date, truckId, includeVoided = false }, { signal } = {}) {
  const res = await api.get("/truck-trips/day", { query: { date, truckId, includeVoided: includeVoided ? "true" : undefined }, signal });
  return { ...res.data, items: res.data.items.map(fromPheeraDto) };
}

/** Known material and destination names, for suggestions: -> { materials: [{ name, key, category, unit }], destinations: [{ name, key }] }. */
export const getPheeraOptions = async ({ signal } = {}) => (await api.get("/truck-trips/options", { signal })).data;

/** One record with its billing history and correction trail. */
export const getPheera = async (id, { signal } = {}) => fromPheeraDto((await api.get(`/truck-trips/${id}`, { signal })).data);

// ---- Writes (owner only on the server) -----------------------------------------------------------------------------

/** Save several Pheeras of ONE truck and date together. -> { records, duplicate, summary }. See toBatchBody for the row shape. */
export async function createPheeraBatch({ truckId, businessDate, rows, submissionId = newSubmissionId() }) {
  const res = await api.post("/truck-trips/batch", toBatchBody({ truckId, businessDate, submissionId, rows }));
  return { records: res.data.map(fromPheeraDto), duplicate: Boolean(res.meta?.duplicate), summary: res.meta?.summary ?? null, submissionId };
}

/** Save ONE Pheera. -> { record, duplicate }. */
export async function createPheera({ truckId, businessDate, row, clientRowId, submissionId = newSubmissionId() }) {
  const res = await api.post("/truck-trips", toSingleBody({ truckId, businessDate, submissionId, clientRowId, row }));
  return { record: fromPheeraDto(res.data), duplicate: Boolean(res.meta?.duplicate), submissionId };
}

/** Correct a Pheera (a reason is required; refused with 409 while it is reserved in a draft bill or billed). */
export const correctPheera = async (id, changes, reason) => fromPheeraDto((await api.patch(`/truck-trips/${id}`, toCorrectionBody(changes, reason))).data);

/** Void a Pheera with a reason (soft delete; its number is never reused; refused with 409 while reserved or billed). */
export const voidPheera = async (id, reason) => fromPheeraDto((await api.post(`/truck-trips/${id}/void`, { reason: String(reason ?? "").trim() })).data);

/** Give a Pheera a customer (a historical one, or fix a wrong customer while it is not reserved or billed). */
export const assignPheeraCustomer = async (id, customerId, reason) => fromPheeraDto((await api.patch(`/truck-trips/${id}/customer`, { customerId, reason: String(reason ?? "").trim() })).data);

/** Release a BILLED Pheera whose invoice was cancelled, so it can be billed again (a reason is required). */
export const releasePheera = async (id, reason) => fromPheeraDto((await api.post(`/truck-trips/${id}/release`, { reason: String(reason ?? "").trim() })).data);
