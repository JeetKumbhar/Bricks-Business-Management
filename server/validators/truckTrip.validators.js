import { z } from "zod";
import { MATERIAL_CATEGORY_VALUES, MAX_DESTINATION, MAX_REMARKS, MAX_TRIPS_PER_BATCH, MIN_DESTINATION, UNIT_VALUES } from "../constants/truck.js";
import { isValidBusinessDate } from "../utils/dates.js";
import { resolveTripMaterial } from "../utils/truckRules.js";

// Request shapes for /api/truck-trips. Strict: unknown fields are rejected. The Pheera number, the truck registration snapshot,
// the unit's label and totals are never accepted from the client (the server assigns / derives them). The material decides the
// unit: Bricks -> whole bricks; Soil and Other -> tonnes. Quantities are JSON numbers, never text. Whether a date is in the
// future depends on the clock, so the service checks that.
const businessDate = z.string().refine(isValidBusinessDate, "Use a real date in YYYY-MM-DD form");
const objectId = (label) => z.string().regex(/^[0-9a-f]{24}$/, `Not a valid ${label} id`);
const truckId = objectId("truck");
const submissionId = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/, "submissionId must be 8 to 64 letters, digits, - or _");
const clientRowId = z.string().regex(/^[A-Za-z0-9_-]{1,40}$/, "clientRowId must be 1 to 40 letters, digits, - or _");
const reason = z.string().trim().min(3, "Please give a reason").max(200, "Reason is too long");

const material = z.enum(MATERIAL_CATEGORY_VALUES, { error: "Choose Bricks, Soil or Other" });
const customMaterialName = z.string().nullable();
const destination = z.string().trim().min(MIN_DESTINATION, "Enter the destination").max(MAX_DESTINATION, "Destination is too long");
const quantity = z.number({ error: "Quantity must be a number" });
const unit = z.enum(UNIT_VALUES);
const remarks = z.string().trim().max(MAX_REMARKS, "Remarks are too long");

const tripFields = { material, customMaterialName: customMaterialName.optional(), destination, quantity, unit: unit.optional(), remarks: remarks.optional() };

/** The material / quantity / unit rules, reported against the field the person has to fix. */
const checkMaterial = (row, ctx) => {
  const result = resolveTripMaterial({ material: row.material, customMaterialName: row.customMaterialName ?? "", quantity: row.quantity, unit: row.unit });
  for (const [field, message] of Object.entries(result.errors ?? {})) ctx.addIssue({ code: "custom", path: [field], message });
};

const rowSchema = z.strictObject({ ...tripFields, clientRowId: clientRowId.optional() }).superRefine(checkMaterial);

export const idParamsSchema = z.strictObject({ id: objectId("Pheera") });
export const truckParamsSchema = z.strictObject({ truckId });

/** One Pheera. An array is rejected: a record is exactly one trip. */
export const createTripSchema = z.strictObject({ truckId, businessDate, submissionId: submissionId.optional(), clientRowId: clientRowId.optional(), ...tripFields }).superRefine(checkMaterial);

/** Several Pheera for one truck and date; each row becomes its own record, all saved together or none. */
export const batchSchema = z
  .strictObject({ truckId, businessDate, submissionId: submissionId.optional(), trips: z.array(rowSchema).min(1, "Add at least one Pheera").max(MAX_TRIPS_PER_BATCH, `At most ${MAX_TRIPS_PER_BATCH} Pheera per save`) })
  .superRefine((body, ctx) => {
    const seen = new Set();
    body.trips.forEach((row, i) => {
      if (!row.clientRowId) return;
      if (seen.has(row.clientRowId)) ctx.addIssue({ code: "custom", path: ["trips", i, "clientRowId"], message: "This row id appears more than once" });
      seen.add(row.clientRowId);
    });
  });

/**
 * Correction. The truck, date and Pheera number never change. Changing the material needs the quantity sent again (checked by
 * the service against the NEW unit), so a number is never silently reinterpreted in a different unit. A reason is required.
 */
export const correctionSchema = z
  .strictObject({ material: material.optional(), customMaterialName: customMaterialName.optional(), destination: destination.optional(), quantity: quantity.optional(), unit: unit.optional(), remarks: remarks.optional(), reason })
  .superRefine((b, ctx) => {
    if (!["material", "destination", "quantity", "remarks"].some((k) => b[k] !== undefined)) ctx.addIssue({ code: "custom", path: ["quantity"], message: "Send at least one field to change" });
    if (b.material === undefined && b.customMaterialName) ctx.addIssue({ code: "custom", path: ["material"], message: "Send the material together with a custom name" });
    if (b.material !== undefined) {
      // Name and unit rules only; the quantity is checked by the service (it may be unchanged).
      const result = resolveTripMaterial({ material: b.material, customMaterialName: b.customMaterialName ?? "", quantity: b.quantity ?? 1, unit: b.unit });
      for (const [field, message] of Object.entries(result.errors ?? {})) ctx.addIssue({ code: "custom", path: [field], message });
    }
  });

export const voidSchema = z.strictObject({ reason });

const flag = z.enum(["true", "false"]).transform((v) => v === "true");
const rangeOrder = (q, ctx) => {
  if (q.date && (q.from || q.to)) ctx.addIssue({ code: "custom", path: ["date"], message: "Use either date or from / to, not both" });
  if (q.from && q.to && q.from > q.to) ctx.addIssue({ code: "custom", path: ["to"], message: "to must be on or after from" });
};

// Filters combine with AND. registration is a contains-match that ignores case, spaces and hyphens; material is the category;
// materialName and destination match the actual name, ignoring case and extra spaces.
export const filterFields = {
  truckId: truckId.optional(),
  registration: z.string().trim().min(1).max(20).optional(),
  material: material.optional(),
  materialName: z.string().trim().min(1).max(40).optional(),
  destination: z.string().trim().min(1).max(MAX_DESTINATION).optional(),
  date: businessDate.optional(),
  from: businessDate.optional(),
  to: businessDate.optional(),
};
export const listQuerySchema = z.strictObject({ ...filterFields, includeVoided: flag.default(false), page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(500).default(100) }).superRefine(rangeOrder);
export const dayQuerySchema = z.strictObject({ date: businessDate, truckId: truckId.optional(), includeVoided: flag.default(false) });
export const rangeCheck = rangeOrder;
