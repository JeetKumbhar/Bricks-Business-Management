import { z } from "zod";
import { ATTENDANCE_STATUS_VALUES, MAX_ENTRIES_PER_SAVE } from "../constants/attendance.js";
import { LABOUR_ID_PATTERN } from "../constants/labour.js";
import { isValidBusinessDate } from "../utils/dates.js";

// Request shapes for /api/attendance. They match the frontend's saveAttendance(date, [{ labourId, status }]).
// Strict everywhere: an unknown field (an id, a rate, a client-sent history) is rejected, never silently ignored.
// Whether a date is in the future depends on the clock, so the service checks that; here only the format.

const businessDate = z.string().refine(isValidBusinessDate, "Use a real date in YYYY-MM-DD form");
const labourId = z.string().regex(LABOUR_ID_PATTERN, "Not a valid labour id");

export const dateParamsSchema = z.strictObject({ date: businessDate });
export const recordParamsSchema = z.strictObject({ date: businessDate, labourId });
export const labourParamsSchema = z.strictObject({ id: labourId });

const entry = z.strictObject({ labourId, status: z.enum(ATTENDANCE_STATUS_VALUES, { error: "Status must be PRESENT, HALF_DAY or ABSENT" }) });

export const saveDaySchema = z
  .strictObject({
    entries: z.array(entry).min(1, "Send at least one entry").max(MAX_ENTRIES_PER_SAVE, `At most ${MAX_ENTRIES_PER_SAVE} entries per save`),
    // Optional note, kept in the audit trail of any record this save corrects.
    reason: z.string().trim().min(3, "Please give a reason").max(200, "Reason is too long").optional(),
  })
  .superRefine((body, ctx) => {
    const seen = new Set();
    body.entries.forEach((e, i) => {
      if (seen.has(e.labourId)) ctx.addIssue({ code: "custom", path: ["entries", i, "labourId"], message: "This labour appears more than once" });
      seen.add(e.labourId);
    });
  });

// One day (?date=) OR a range (?from=&to=), optionally narrowed to one labour and/or one status.
export const listQuerySchema = z
  .strictObject({
    date: businessDate.optional(),
    from: businessDate.optional(),
    to: businessDate.optional(),
    labourId: labourId.optional(),
    status: z.enum(ATTENDANCE_STATUS_VALUES).optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(500).default(100),
  })
  .superRefine((q, ctx) => {
    if (!q.date && !q.from && !q.to) ctx.addIssue({ code: "custom", path: ["date"], message: "Give a date, or a from / to range" });
    if (q.date && (q.from || q.to)) ctx.addIssue({ code: "custom", path: ["date"], message: "Use either date or from / to, not both" });
    if (q.from && q.to && q.from > q.to) ctx.addIssue({ code: "custom", path: ["to"], message: "to must be on or after from" });
  });

// The profile history of one labour: an optional date range, newest first.
export const labourHistoryQuerySchema = z
  .strictObject({ from: businessDate.optional(), to: businessDate.optional() })
  .superRefine((q, ctx) => {
    if (q.from && q.to && q.from > q.to) ctx.addIssue({ code: "custom", path: ["to"], message: "to must be on or after from" });
  });
