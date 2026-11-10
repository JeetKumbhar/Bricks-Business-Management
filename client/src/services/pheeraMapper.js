// Pheera (truck trip) <-> server shapes. The ONE place that knows both the screens' record names and the server's
// (server/services/truckTrip.service.js `toTripDto`, server/validators/truckTrip.validators.js).
//
// The server owns: the Pheera number (`pheeraNo`, per truck and date, never reused), the truck registration snapshot, the unit (Bricks ->
// bricks; every other material -> tonnes), totals and the billing status. Nothing here computes or overrides any of them, and none of
// them is ever sent. A record keeps BOTH name sets, so existing screens and selectors keep working while new code can use the server names:
//   pheeraNo -> also pheeraNumber      truckNumber -> also truckRegistration      materialName -> also material
//   isVoided -> also isDeleted         voidReason/voidedAt -> also deletedReason/deletedAt      submissionId -> also batchId
// Historical Pheeras (saved before customers existed) have customer = null and billingStatus = null. Those stay null: nothing is guessed.
import { BRICKS, SOIL } from "../utils/materials";

const SERVER_CATEGORY = Object.freeze({ BRICKS: "BRICKS", SOIL: "SOIL", OTHER: "OTHER" });

/** Server record -> screen record. Missing optional values are made safe; billing values are never invented. */
export const fromPheeraDto = (dto) => ({
  ...dto,
  pheeraNumber: dto.pheeraNo,
  truckRegistration: dto.truckNumber,
  material: dto.materialName,
  isDeleted: Boolean(dto.isVoided),
  deletedReason: dto.voidReason ?? null,
  deletedAt: dto.voidedAt ?? null,
  batchId: dto.submissionId ?? null,
  remarks: dto.remarks ?? "",
  customer: dto.customer ?? null,
  customerId: dto.customer?.id ?? null,
  customerName: dto.customer?.name ?? null,
  billingStatus: dto.billingStatus ?? null,
  billId: dto.billId ?? null,
  bill: dto.bill ?? null,
  reservedAt: dto.reservedAt ?? null,
  billedAt: dto.billedAt ?? null,
  isVoided: Boolean(dto.isVoided),
  corrected: Boolean(dto.corrected),
});

/**
 * The server's material fields for a material NAME as the screens hold it ("Bricks", "Soil", "Sand", "Stone Dust" ...):
 * Bricks and Soil are categories with fixed names; every other name is category OTHER with the real name as customMaterialName.
 */
export const materialFields = (materialName) => {
  const name = String(materialName ?? "").replace(/\s+/g, " ").trim();
  if (name === BRICKS) return { material: SERVER_CATEGORY.BRICKS };
  if (name === SOIL) return { material: SERVER_CATEGORY.SOIL };
  return { material: SERVER_CATEGORY.OTHER, customMaterialName: name };
};

const quantityNumber = (value) => {
  const n = typeof value === "number" ? value : Number(String(value ?? "").trim());
  if (String(value ?? "").trim() === "" || !Number.isFinite(n)) throw new Error("Quantity must be a number");
  return n; // a JSON number, never text
};

const CLIENT_ROW_ID = /^[A-Za-z0-9_-]{1,40}$/;
const SUBMISSION_ID = /^[A-Za-z0-9_-]{8,64}$/;

/** A fresh idempotency key for one save attempt. Reuse the SAME one when retrying after a lost connection. */
export const newSubmissionId = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`);

/**
 * One validated row -> one server row. `row` = { customerId, material (real name), destination, quantity, remarks } as produced by the
 * entry form. unit, Pheera number and truck registration are NOT sent (the server derives them).
 */
export const toTripRow = (row, clientRowId) => {
  if (!row.customerId) throw new Error("A customer is required for every Pheera");
  const out = {
    customerId: row.customerId,
    ...materialFields(row.material),
    destination: String(row.destination ?? "").replace(/\s+/g, " ").trim(),
    quantity: quantityNumber(row.quantity),
    remarks: String(row.remarks ?? "").replace(/\s+/g, " ").trim(),
  };
  if (clientRowId !== undefined) {
    if (!CLIENT_ROW_ID.test(clientRowId)) throw new Error("A row id must be 1 to 40 letters, digits, - or _");
    out.clientRowId = clientRowId;
  }
  return out;
};

/** Body of POST /truck-trips/batch: one truck, one date, 1 to 50 rows saved together or not at all. Each row gets a clientRowId. */
export const toBatchBody = ({ truckId, businessDate, submissionId, rows }) => {
  if (!truckId) throw new Error("Choose a truck");
  if (!Array.isArray(rows) || rows.length === 0) throw new Error("Add at least one Pheera");
  const body = { truckId, businessDate, trips: rows.map((r, i) => toTripRow(r, r.clientRowId ?? `row-${i + 1}`)) };
  if (submissionId !== undefined) {
    if (!SUBMISSION_ID.test(submissionId)) throw new Error("A submission id must be 8 to 64 letters, digits, - or _");
    body.submissionId = submissionId;
  }
  return body;
};

/** Body of POST /truck-trips (a single Pheera): the row fields sit beside truckId and businessDate. */
export const toSingleBody = ({ truckId, businessDate, submissionId, clientRowId, row }) => {
  if (!truckId) throw new Error("Choose a truck");
  const body = { truckId, businessDate, ...toTripRow(row, clientRowId) };
  if (submissionId !== undefined) {
    if (!SUBMISSION_ID.test(submissionId)) throw new Error("A submission id must be 8 to 64 letters, digits, - or _");
    body.submissionId = submissionId;
  }
  return body;
};

/**
 * Body of PATCH /truck-trips/:id (a correction). A reason is required. Truck, date and Pheera number never change. When the material
 * changes the quantity must be sent again (the server checks it against the NEW unit), so it is sent whenever either is given.
 */
export const toCorrectionBody = (changes, reason) => {
  const why = String(reason ?? "").trim();
  const body = {};
  if (changes.material !== undefined) Object.assign(body, materialFields(changes.material));
  if (changes.destination !== undefined) body.destination = String(changes.destination).replace(/\s+/g, " ").trim();
  if (changes.quantity !== undefined) body.quantity = quantityNumber(changes.quantity);
  if (changes.remarks !== undefined) body.remarks = String(changes.remarks).replace(/\s+/g, " ").trim();
  if (Object.keys(body).length === 0) throw new Error("Nothing was changed");
  if (body.material !== undefined && body.quantity === undefined) throw new Error("Send the quantity again when the material changes");
  body.reason = why;
  return body;
};

/** Query for GET /truck-trips from the screens' filters. Empty values are left out; booleans become the strings the server expects. */
export const toListQuery = (filters = {}) => {
  const { truckId, registration, material, materialName, destination, date, from, to, customerId, billingStatus, billId, billable, includeVoided } = filters;
  return {
    truckId, registration, material, materialName, destination, date, from, to, customerId, billingStatus, billId,
    billable: billable ? "true" : undefined,
    includeVoided: includeVoided ? "true" : undefined,
  };
};
