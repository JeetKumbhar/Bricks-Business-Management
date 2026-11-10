// Customers: everything the screens say to /api/customers, in one place (server/routes/customer.routes.js,
// server/validators/customer.validators.js, server/services/customer.service.js). Responses: { success, message, data, meta? }.
// The server stays the authority: it decides name uniqueness (ignoring case and spaces, archived names included), what the built-in
// "Internal / No Bill" customer may do, and who may write (owner only). Nothing here falls back to sample data: a failed call throws.
import { api } from "./api";
import { fetchAllPages } from "./labourApi";

/** The fields a customer form may send (the server rejects anything else, including kind and customerKey). */
export const CUSTOMER_FIELDS = ["name", "address", "gstin", "stateName", "stateCode", "contact"];

const text = (v) => (v === undefined || v === null ? undefined : String(v).trim());

/** A customer DTO as the screens use it. The server's fields are kept as they are; only missing values are made safe. */
export const fromCustomerDto = (dto) => ({
  ...dto,
  kind: dto.kind ?? "NORMAL",
  isInternal: Boolean(dto.isInternal),
  isArchived: Boolean(dto.isArchived),
  address: dto.address ?? "",
  gstin: dto.gstin ?? "",
  stateName: dto.stateName ?? "",
  stateCode: dto.stateCode ?? "",
  contact: dto.contact ?? "",
  revision: dto.revision ?? 1,
  history: dto.history ?? [],
});

/** May this customer be chosen for a normal sale (a new Pheera, an invoice)? Never archived or Internal / No Bill. */
export const isSelectableForSale = (customer) => Boolean(customer) && !customer.isArchived && !customer.isInternal;

/** Form values -> POST /customers body. Only fields that were filled in are sent; GSTIN is upper-cased. */
export const toCreateCustomerBody = (values) => {
  const body = {};
  for (const field of CUSTOMER_FIELDS) {
    const value = text(values[field]);
    if (value === undefined || (field !== "name" && value === "")) continue;
    body[field] = field === "gstin" ? value.toUpperCase() : value;
  }
  return body;
};

/** Only the fields that really changed, plus the revision the screen saw (the server refuses a stale edit). */
export const toUpdateCustomerBody = (current, changes) => {
  const body = {};
  for (const field of CUSTOMER_FIELDS) {
    if (changes[field] === undefined) continue;
    const next = field === "gstin" ? text(changes[field]).toUpperCase() : text(changes[field]);
    if (next !== (current[field] ?? "")) body[field] = next;
  }
  if (Object.keys(body).length > 0 && current.revision !== undefined) body.revision = current.revision;
  return body;
};

// ---- Reads ---------------------------------------------------------------------------------------------------------

/** One page: -> { items, meta: { page, limit, total } }. Archived customers only when includeArchived is true. */
export async function listCustomers({ search, kind, includeArchived = false, page = 1, limit = 100 } = {}, { signal } = {}) {
  const res = await api.get("/customers", { query: { search, kind, includeArchived: includeArchived ? "true" : undefined, page, limit }, signal });
  return { items: res.data.map(fromCustomerDto), meta: res.meta ?? {} };
}

/** Every customer matching the filters (500 per page, checked against the server's total; throws rather than return a partial list). */
export async function fetchAllCustomers({ search, kind, includeArchived = false } = {}, { signal } = {}) {
  const rows = await fetchAllPages("/customers", { search, kind, includeArchived: includeArchived ? "true" : undefined }, { signal });
  return rows.map(fromCustomerDto);
}

export const getCustomer = async (id, { signal } = {}) => fromCustomerDto((await api.get(`/customers/${id}`, { signal })).data);

// ---- Writes (owner only on the server) -----------------------------------------------------------------------------

export const createCustomer = async (values) => fromCustomerDto((await api.post("/customers", toCreateCustomerBody(values))).data);

/** `current` is the customer as loaded (its revision is sent). Throws before any request when nothing changed. */
export async function updateCustomer(current, changes) {
  const body = toUpdateCustomerBody(current, changes);
  if (Object.keys(body).length === 0) throw new Error("Nothing was changed");
  return fromCustomerDto((await api.patch(`/customers/${current.id}`, body)).data);
}

/** Archive (soft delete). The server requires a reason of 3 to 200 characters and refuses the Internal customer. */
export const archiveCustomer = async (id, reason) => fromCustomerDto((await api.delete(`/customers/${id}`, { reason: String(reason ?? "").trim() })).data);

/** The explicit way back for an archived customer. The reason is optional. */
export const restoreCustomer = async (id, reason) => {
  const why = String(reason ?? "").trim();
  return fromCustomerDto((await api.post(`/customers/${id}/restore`, why ? { reason: why } : {})).data);
};

/** Creates the built-in "Internal / No Bill" customer the first time, and returns it unchanged every time after. */
export const enableInternalCustomer = async () => fromCustomerDto((await api.post("/customers/internal", {})).data);
