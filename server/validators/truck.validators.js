import { z } from "zod";
import { LABOUR_ID_PATTERN } from "../constants/labour.js";
import { MAX_CAPACITY_TONNES, MAX_MODEL, MAX_NICKNAME, MAX_NOTE, MAX_TRUCK_NUMBER, STOP_REASONS, STOP_REASON_VALUES, TRUCK_STATUS, TRUCK_STATUS_VALUES } from "../constants/truck.js";
import { truckNumberKey } from "../utils/truckRules.js";

// Request shapes for /api/trucks. Strict: unknown fields are rejected (status, history and ids are never set through the
// create / update body; status has its own endpoint so every change is recorded).
const truckNumber = z
  .string()
  .trim()
  .min(3, "Registration number is required")
  .max(MAX_TRUCK_NUMBER, "Registration number is too long")
  .refine((v) => truckNumberKey(v).length >= 3, "Registration number needs at least 3 letters or digits");
const nickname = z.string().trim().max(MAX_NICKNAME, "Nickname is too long");
const model = z.string().trim().max(MAX_MODEL, "Model is too long");
const capacity = z.number({ error: "Capacity must be a number" }).positive("Capacity must be greater than 0").max(MAX_CAPACITY_TONNES, `Capacity cannot be more than ${MAX_CAPACITY_TONNES}`);
const driverId = z.string().regex(LABOUR_ID_PATTERN, "Not a valid driver id");
const note = z.string().trim().max(MAX_NOTE, "Note is too long");

export const idParamsSchema = z.strictObject({ id: z.string().regex(/^[0-9a-f]{24}$/, "Not a valid truck id") });

export const createTruckSchema = z.strictObject({
  truckNumber,
  nickname: nickname.optional(),
  model: model.optional(),
  capacity: capacity.nullable().optional(),
  driverId: driverId.nullable().optional(),
});

export const updateTruckSchema = z
  .strictObject({ truckNumber: truckNumber.optional(), nickname: nickname.optional(), model: model.optional(), capacity: capacity.nullable().optional(), driverId: driverId.nullable().optional() })
  .refine((b) => Object.keys(b).length > 0, { path: ["truckNumber"], message: "Send at least one field to change" });

/** Stopped needs a reason (Other also needs a note); Maintenance needs a description; a reason only makes sense for Stopped. */
export const statusChangeSchema = z
  .strictObject({ status: z.enum(TRUCK_STATUS_VALUES, { error: "Choose Working, Stopped or Maintenance" }), reason: z.enum(STOP_REASON_VALUES).optional(), note: note.optional(), description: note.optional() })
  .superRefine((b, ctx) => {
    const add = (path, message) => ctx.addIssue({ code: "custom", path: [path], message });
    if (b.status === TRUCK_STATUS.STOPPED) {
      if (!b.reason) add("reason", "Choose why the truck stopped");
      else if (b.reason === STOP_REASONS.OTHER && !b.note) add("note", "A note is required when the reason is Other");
    } else if (b.reason) add("reason", "A reason is only for Stopped");
    if (b.status === TRUCK_STATUS.MAINTENANCE && (b.description ?? "").length < 3) add("description", "Describe the maintenance work");
  });

export const listQuerySchema = z.strictObject({ status: z.enum(TRUCK_STATUS_VALUES).optional(), search: z.string().trim().max(40).optional() });
