import { z } from "zod";
import { LABOUR_STATUS_VALUES, LABOUR_TYPES, MAX_RATE_RUPEES, MAX_TEAM_MEMBERS, MOBILE_PATTERN } from "../constants/labour.js";
import { isFutureBusinessDate, isValidBusinessDate } from "../utils/dates.js";

// Request shapes for /api/labours. They match what the frontend form already produces (toLabourInput in
// client/src/features/labours/labourRecord.js): one rate field named after the type. Strict everywhere, so an unknown
// field (a Maapvali with a dailyRate, a client-sent id or status history) is rejected instead of silently ignored.

const businessDate = z.string().refine(isValidBusinessDate, "Use a real date in YYYY-MM-DD form");
const joiningDate = businessDate.refine((value) => !isValidBusinessDate(value) || !isFutureBusinessDate(value), "Joining date cannot be in the future");
// Whole rupees or up to 2 decimals; the exact decimal check happens when it is converted to paise.
const rate = z.number("Rate must be a number").positive("Rate must be greater than 0").max(MAX_RATE_RUPEES, `Rate cannot be more than ${MAX_RATE_RUPEES}`);

const name = z.string().trim().min(2, "Name is required").max(60, "Name is too long");
const mobile = z.string().trim().regex(MOBILE_PATTERN, "Enter a valid 10-digit mobile number");
const village = z.string().trim().min(1, "Village is required").max(60, "Village name is too long");
const status = z.enum(LABOUR_STATUS_VALUES);
const members = z
  .array(z.strictObject({ name: z.string().trim().min(1, "Member name is required").max(60), relation: z.string().trim().max(30).optional() }))
  .max(MAX_TEAM_MEMBERS, `A team can list at most ${MAX_TEAM_MEMBERS} members`);

const common = { name, mobile, village, joiningDate, status: status.default("ACTIVE") };

export const createLabourSchema = z.discriminatedUnion("labourType", [
  z.strictObject({ labourType: z.literal(LABOUR_TYPES.BIGARI), ...common, dailyRate: rate }),
  z.strictObject({ labourType: z.literal(LABOUR_TYPES.MAAPVALI), ...common, ratePerFourMaaps: rate }),
  z.strictObject({ labourType: z.literal(LABOUR_TYPES.PATLAVALE), ...common, ratePer1000PayableBricks: rate, members: members.optional() }),
]);

// Edit: only these fields. The type and the rate can never be changed here (the rate has its own endpoint).
export const updateLabourSchema = z
  .strictObject({
    name: name.optional(),
    mobile: mobile.optional(),
    village: village.optional(),
    joiningDate: businessDate.optional(),
    status: status.optional(),
    statusReason: z.string().trim().min(3, "Please give a reason").max(200, "Reason is too long").optional(),
    members: members.optional(),
  })
  .refine((body) => Object.keys(body).length > 0, "Send at least one field to change")
  .refine((body) => body.statusReason === undefined || body.status !== undefined, { path: ["statusReason"], message: "statusReason needs a status" });

// Same field names as the frontend's change-rate form.
export const rateChangeSchema = z.strictObject({
  newRate: rate,
  effectiveFrom: businessDate,
  reason: z.string().trim().min(3, "Please give a reason").max(200, "Reason is too long"),
});

export const listQuerySchema = z.strictObject({
  type: z.enum(["ALL", ...Object.values(LABOUR_TYPES)]).default("ALL"),
  status: z.enum(["ALL", "NEW", ...LABOUR_STATUS_VALUES]).default("ALL"),
  search: z.string().trim().max(60, "Search is too long").default(""),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});
