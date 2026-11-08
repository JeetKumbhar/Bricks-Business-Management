// Everything the Labour / Attendance / Maapvali / Patlavale / Season screens say to the backend, in one place.
// Endpoint names, query names and body shapes are taken from the server's routes and validators
// (server/routes/*.routes.js, server/validators/*.validators.js). Responses follow { success, message, data, meta }.
// The server stays the authority: it re-validates everything and decides rates, earnings, seasons and duplicates.
import { LABOUR_TYPE_META } from "../utils/labourTypes";
import { api } from "./api";

const PAGE_SIZE = 500; // the largest page the server allows
const SINCE = "2000-01-01"; // "from the beginning": the list endpoints need a date range, an open end is allowed
const RATE_FETCH_PARALLEL = 6;

const range = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

/** Runs `fn` over `items`, at most `limit` at a time, keeping the order of the results. */
export async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/**
 * Every record of a paged list endpoint. Reads page 1, then the remaining pages together. The result is de-duplicated by id
 * and must add up to the server's own total; if records were added or removed while paging it reads everything once more,
 * and fails rather than return a list that might be missing rows (a wrong total is worse than an error).
 */
export async function fetchAllPages(path, query = {}, { signal, attempts = 2 } = {}) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const first = await api.get(path, { query: { ...query, page: 1, limit: PAGE_SIZE }, signal });
    const total = first.meta?.total ?? first.data.length;
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const rest = await Promise.all(range(2, pages).map((page) => api.get(path, { query: { ...query, page, limit: PAGE_SIZE }, signal })));

    const byId = new Map();
    for (const response of [first, ...rest]) for (const item of response.data) byId.set(item.id, item);
    if (byId.size === total) return [...byId.values()];
  }
  throw new Error("The data changed while it was loading. Please try again.");
}

// ---- Reads ---------------------------------------------------------------------------------------------------------

export const getRateHistory = async (labourId, { signal } = {}) => (await api.get(`/labours/${labourId}/rates`, { signal })).data;

/**
 * Everything the app needs on screen, read from the server. Fails as a whole when any part fails, so a screen can never
 * show earnings worked out from half the records.
 * Bigari rate histories are loaded here (attendance earnings need the rate in force on each day); the other types read
 * their rate history when a profile is opened.
 */
export async function loadAllData({ signal } = {}) {
  const [labours, attendance, maapEntries, productionEntries, seasons, payments] = await Promise.all([
    fetchAllPages("/labours", {}, { signal }),
    fetchAllPages("/attendance", { from: SINCE }, { signal }),
    fetchAllPages("/maap-entries", { from: SINCE }, { signal }),
    fetchAllPages("/production-entries", { from: SINCE }, { signal }),
    api.get("/seasons", { signal }).then((r) => r.data),
    fetchAllPages("/payments", { includeDeleted: true }, { signal }),
  ]);
  const bigari = labours.filter((l) => l.labourType === "BIGARI");
  const rateLists = await mapLimit(bigari, RATE_FETCH_PARALLEL, (l) => getRateHistory(l.id, { signal }));
  return { labours, attendance, maapEntries, productionEntries, seasons, payments, rateChanges: rateLists.flat() };
}

/** Used as a safety net after a create whose answer did not carry a usable id (see LabourContext). */
export const loadPayments = ({ signal } = {}) => fetchAllPages("/payments", { includeDeleted: true }, { signal });
export const loadSeasons = async ({ signal } = {}) => (await api.get("/seasons", { signal })).data;

// ---- Labour --------------------------------------------------------------------------------------------------------

const EDITABLE_FIELDS = ["name", "mobile", "village", "joiningDate", "status"];

/** Form input -> POST /labours body. Only the rate field of the chosen type is sent (the server rejects any other). */
export const toCreateLabourBody = (values) => {
  const meta = LABOUR_TYPE_META[values.labourType];
  if (!meta) throw new Error(`Unknown labour type: ${values.labourType}`);
  return {
    labourType: values.labourType,
    name: values.name,
    mobile: values.mobile,
    village: values.village,
    joiningDate: values.joiningDate,
    status: values.status,
    [meta.rateField]: Number(values[meta.rateField]),
  };
};

/** Only the editable fields that really changed. Type and rate never go through this call. */
export const toUpdateLabourBody = (current, changes) => {
  const body = {};
  for (const field of EDITABLE_FIELDS) {
    if (changes[field] !== undefined && changes[field] !== current[field]) body[field] = changes[field];
  }
  return body;
};

export const createLabour = async (values) => (await api.post("/labours", toCreateLabourBody(values))).data;
export const patchLabour = async (id, body) => (await api.patch(`/labours/${id}`, body)).data;
/** -> { rate, labour } */
export const postRateChange = async (id, { rate, effectiveFrom, reason }) => (await api.post(`/labours/${id}/rates`, { newRate: Number(rate), effectiveFrom, reason })).data;

// ---- Attendance / Maapvali / Patlavale: save a day, correct, delete ----------------------------------------------------

/** -> { date, items, summary, saved: { created, updated, unchanged } } */
export const saveAttendanceDay = async (date, entries, reason) => (await api.put(`/attendance/${date}`, { entries, ...(reason ? { reason } : {}) })).data;

export const saveMaapDayRequest = async (date, rows, reason) => (await api.put(`/maap-entries/day/${date}`, { rows, ...(reason ? { reason } : {}) })).data;
export const correctMaapEntry = async (id, body) => (await api.patch(`/maap-entries/${id}`, body)).data;
export const removeMaapEntry = async (id, reason) => (await api.delete(`/maap-entries/${id}`, { reason })).data;

export const saveProductionDayRequest = async (date, rows, reason) => (await api.put(`/production-entries/day/${date}`, { rows, ...(reason ? { reason } : {}) })).data;
export const correctProductionEntry = async (id, body) => (await api.patch(`/production-entries/${id}`, body)).data;
export const removeProductionEntry = async (id, reason) => (await api.delete(`/production-entries/${id}`, { reason })).data;

// ---- Seasons -----------------------------------------------------------------------------------------------------------

export const createSeasonRequest = async ({ name, startDate, endDate }) => (await api.post("/seasons", { name, startDate, ...(endDate ? { endDate } : {}) })).data;
