import { z } from "zod";
import { TRUCK_STATUS, STOP_REASONS } from "../utils/truckStatus";
import { toISODate } from "../utils/formatDate";

const optionalAmount = (label) =>
  z
    .string()
    .trim()
    .refine((v) => v === "" || (Number.isFinite(Number(v)) && Number(v) >= 0), `${label} must be a number of 0 or more`)
    .transform((v) => (v === "" ? null : Number(v)));

/** Add / edit truck. Truck number must be unique (checked by the form, which knows the other trucks). */
export const truckSchema = z.object({
  truckNumber: z.string().trim().min(3, "Truck number is required").max(20, "Truck number is too long"),
  model: z.string().trim().max(60, "Model is too long"),
  capacity: z
    .string()
    .trim()
    .refine((v) => v === "" || (Number.isFinite(Number(v)) && Number(v) > 0), "Capacity must be greater than 0")
    .transform((v) => (v === "" ? null : Number(v))),
  driverId: z.string(),
});

/**
 * Status change form. Rules: pick a different status; Stopped needs a reason (Other also needs a note);
 * Maintenance needs a description. The cost is optional.
 */
export const makeStatusChangeSchema = (currentStatus) =>
  z
    .object({
      status: z.enum([TRUCK_STATUS.WORKING, TRUCK_STATUS.STOPPED, TRUCK_STATUS.MAINTENANCE]),
      reason: z.string(),
      note: z.string().trim().max(200, "Note is too long"),
      description: z.string().trim().max(200, "Description is too long"),
      cost: optionalAmount("Cost"),
    })
    .superRefine((v, ctx) => {
      const add = (path, message) => ctx.addIssue({ code: "custom", path: [path], message });
      if (v.status === currentStatus) add("status", "Choose a different status");
      if (v.status === TRUCK_STATUS.STOPPED) {
        if (!Object.values(STOP_REASONS).includes(v.reason)) add("reason", "Choose why the truck stopped");
        else if (v.reason === STOP_REASONS.OTHER && !v.note) add("note", "A note is required when the reason is Other");
      }
      if (v.status === TRUCK_STATUS.MAINTENANCE && v.description.length < 3) add("description", "Describe the maintenance work");
    });

/** A past service record. */
export const serviceRecordSchema = z.object({
  date: z.string().min(1, "Date is required").refine((v) => v <= toISODate(), "Date cannot be in the future"),
  description: z.string().trim().min(3, "Describe the work").max(200, "Description is too long"),
  cost: optionalAmount("Cost"),
});
