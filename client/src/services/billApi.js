// Bills and invoice settings: /api/bills and /api/invoice-settings (server/routes/bill.routes.js, invoiceSettings.routes.js).
// A failed call always throws an ApiError: no sample data, no fallback. Reading is open to signed-in users; every write (and the
// invoice settings, which hold bank details) is owner only on the server. The server calculates every figure and allocates the bill
// number at finalize. Pheera-to-Bill endpoints (/from-trips, /:id/trips) are at the end of this file (Batch 2).
import { api } from "./api";
import { fromPheeraDto } from "./pheeraMapper";
import { fromBillDto, fromSettingsDto, toCancelRequest, toFinalizeRequest, toSettingsRequest } from "../features/bills/billContract";

const PAGE_SIZE = 100; // the largest page /api/bills allows

/** One bill list row (no items) -> the shape the screens use. Totals are the SERVER's; `listOnly` marks a row without items. */
export const fromBillListDto = (dto) => ({
  ...dto,
  listOnly: true,
  customer: { name: dto.customerName ?? "", address: "", gstin: dto.customerGstin ?? "", stateName: "", stateCode: "", contact: "" },
  items: [],
  notes: "",
});

/** Every bill matching the filters, page by page, checked against the server total (throws instead of returning a partial list). */
export async function fetchAllBills(filters = {}, { signal, attempts = 2 } = {}) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const read = (page) => api.get("/bills", { query: { ...filters, page, limit: PAGE_SIZE }, signal });
    const first = await read(1);
    const total = first.meta?.total ?? first.data.length;
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const rest = await Promise.all(Array.from({ length: pages - 1 }, (_, i) => read(i + 2)));
    const byId = new Map();
    for (const response of [first, ...rest]) for (const row of response.data) byId.set(row.id, row);
    if (byId.size === total) return [...byId.values()].map(fromBillListDto);
  }
  throw new Error("The bills changed while they were loading. Please try again.");
}

/** One bill with its items, seller snapshot, history and the server's totals. */
export const getBill = async (id, { signal } = {}) => fromBillDto((await api.get(`/bills/${id}`, { signal })).data);

/** body = toBillRequest(...). -> the saved draft (revision 1). */
export const createBill = async (body) => fromBillDto((await api.post("/bills", body)).data);
/** body = toBillRequest(value, revision): a stale revision is refused with 409 (nothing saved). */
export const updateBill = async (id, body) => fromBillDto((await api.patch(`/bills/${id}`, body)).data);
export const finalizeBill = async (id, revision) => fromBillDto((await api.post(`/bills/${id}/finalize`, toFinalizeRequest(revision))).data);
export const cancelBill = async (id, reason) => fromBillDto((await api.post(`/bills/${id}/cancel`, toCancelRequest(reason))).data);
/** A draft is hidden, never deleted (it never had a number). */
export const discardBill = async (id, reason) => (await api.post(`/bills/${id}/discard`, reason ? { reason: String(reason).trim() } : {})).data;

export const getInvoiceSettings = async ({ signal } = {}) => fromSettingsDto((await api.get("/invoice-settings", { signal })).data);
export const updateInvoiceSettings = async (settings) => fromSettingsDto((await api.patch("/invoice-settings", toSettingsRequest(settings))).data);

// ---- Pheera <-> Bill (draft bills made from Pheeras) -----------------------------------------------------------------------------
// The server decides everything: which Pheeras are eligible (UNBILLED, ONE active normal customer), the lines (one per Pheera, quantity and
// unit from the Pheera), the totals and the reservation (UNBILLED -> RESERVED). Nothing here computes a status or a number.

/** A bill answer that also carries its Pheeras: -> { bill, trips }. */
const withTrips = (data) => ({ bill: fromBillDto(data), trips: (data.trips ?? []).map(fromPheeraDto) });

/**
 * POST /bills/from-trips. `requestId` makes the request safe to repeat: the same id and the same Pheeras return the draft already made
 * (duplicate: true) instead of a second one. -> { bill, trips, duplicate }
 */
export async function generateBillFromPheeras({ tripIds, requestId }) {
  const res = await api.post("/bills/from-trips", { tripIds, requestId });
  return { ...withTrips(res.data), duplicate: Boolean(res.meta?.duplicate) };
}

/** The Pheeras of a bill, in invoice order, with their current billing status. */
export const getBillTrips = async (id, { signal } = {}) => (await api.get(`/bills/${id}/trips`, { signal })).data.map(fromPheeraDto);

/** Add Pheeras of the draft's own customer to a draft (the revision is checked: a stale one is refused with 409). -> { bill, trips } */
export async function addPheerasToBill(id, tripIds, revision) {
  const res = await api.post(`/bills/${id}/trips`, { tripIds, ...(revision === undefined ? {} : { revision }) });
  return withTrips(res.data);
}

/** Remove ONE Pheera line from a draft; the server releases the Pheera (RESERVED -> UNBILLED). -> { bill, trips } */
export async function removePheeraFromBill(id, tripId) {
  const res = await api.delete(`/bills/${id}/trips/${tripId}`);
  return withTrips(res.data);
}
