import { z } from "zod";
import { MAX_SEASON_NAME_LENGTH, SEASON_STATUS_VALUES } from "../constants/production.js";
import { isValidBusinessDate } from "../utils/dates.js";

// Request shapes for /api/seasons. Strict: unknown fields are rejected. Overlap and "entries outside the new dates" need
// the database, so the service checks those; here only the shape and start <= end.
const businessDate = z.string().refine(isValidBusinessDate, "Use a real date in YYYY-MM-DD form");
const name = z.string().trim().min(2, "Season name is too short").max(MAX_SEASON_NAME_LENGTH, "Season name is too long");
const endAfterStart = (b, ctx) => {
  if (b.startDate && b.endDate && b.endDate < b.startDate) ctx.addIssue({ code: "custom", path: ["endDate"], message: "endDate must be on or after startDate" });
};

export const idParamsSchema = z.strictObject({ id: z.string().regex(/^[0-9a-f]{24}$/, "Not a valid season id") });
export const createSeasonSchema = z.strictObject({ name, startDate: businessDate, endDate: businessDate.nullable().optional() }).superRefine(endAfterStart);
export const updateSeasonSchema = z
  .strictObject({ name: name.optional(), startDate: businessDate.optional(), endDate: businessDate.nullable().optional(), status: z.enum(SEASON_STATUS_VALUES).optional() })
  .superRefine(endAfterStart)
  .refine((b) => Object.keys(b).length > 0, { path: ["name"], message: "Send at least one field to change" });
