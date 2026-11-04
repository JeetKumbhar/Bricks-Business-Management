import { z } from "zod";
import { LABOUR_ID_PATTERN } from "../constants/labour.js";
import { MAX_MAAPS_PER_ENTRY, MAX_NOTE_LENGTH, MAX_ROWS_PER_SAVE } from "../constants/maapvali.js";
import { isValidBusinessDate } from "../utils/dates.js";

// Request shapes for /api/maap-entries. They match the frontend's saveMaapDay(date, rows, reason) and
// updateMaapEntry(id, { date, numberOfMaaps, note }, reason). Strict everywhere: an unknown field (a rate, earnings, an id)
// is rejected, never silently ignored. The rate and the earnings are never accepted from the client.
// Whether a date is in the future depends on the clock, so the service checks that; here only the format.

const businessDate = z.string().refine(isValidBusinessDate, "Use a real date in YYYY-MM-DD form");
const labourId = z.string().regex(LABOUR_ID_PATTERN, "Not a valid labour id");
const entryId = z.string().regex(/^[0-9a-f]{24}$/, "Not a valid entry id");
// A JSON number, not text: "12" or 12.5 or -1 are rejected.
const maaps = z.number({ error: "Maaps must be a number" }).int("Maaps must be a whole number").min(0, "Maaps cannot be negative").max(MAX_MAAPS_PER_ENTRY, `Maaps cannot be more than ${MAX_MAAPS_PER_ENTRY}`);
const note = z.string().trim().max(MAX_NOTE_LENGTH, "Note is too long");
const reason = z.string().trim().min(3, "Please give a reason").max(200, "Reason is too long");

export const dateParamsSchema = z.strictObject({ date: businessDate });
export const idParamsSchema = z.strictObject({ id: entryId });
export const labourParamsSchema = z.strictObject({ id: labourId });

export const saveDaySchema = z
  .strictObject({
    rows: z.array(z.strictObject({ labourId, maaps, note: note.optional() })).min(1, "Send at least one row").max(MAX_ROWS_PER_SAVE, `At most ${MAX_ROWS_PER_SAVE} rows per save`),
    // Required by the service when the date is before today and the save changes anything (the page asks for it too).
    reason: reason.optional(),
  })
  .superRefine((body, ctx) => {
    const seen = new Set();
    body.rows.forEach((row, i) => {
      if (seen.has(row.labourId)) ctx.addIssue({ code: "custom", path: ["rows", i, "labourId"], message: "This worker appears more than once" });
      seen.add(row.labourId);
    });
  });

// Correction: maaps, note and date. The rate is never changed here. A reason is always required.
export const correctionSchema = z
  .strictObject({ date: businessDate.optional(), numberOfMaaps: maaps.optional(), note: note.optional(), reason })
  .refine((b) => b.date !== undefined || b.numberOfMaaps !== undefined || b.note !== undefined, { path: ["numberOfMaaps"], message: "Send at least one field to change" });

export const deleteSchema = z.strictObject({ reason });

const flag = z.enum(["true", "false"]).transform((v) => v === "true");

// One day (?date=) OR a range (?from=&to=), optionally one worker; voided entries only when asked for.
export const listQuerySchema = z
  .strictObject({
    date: businessDate.optional(),
    from: businessDate.optional(),
    to: businessDate.optional(),
    labourId: labourId.optional(),
    includeDeleted: flag.default(false),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(500).default(100),
  })
  .superRefine((q, ctx) => {
    if (!q.date && !q.from && !q.to) ctx.addIssue({ code: "custom", path: ["date"], message: "Give a date, or a from / to range" });
    if (q.date && (q.from || q.to)) ctx.addIssue({ code: "custom", path: ["date"], message: "Use either date or from / to, not both" });
    if (q.from && q.to && q.from > q.to) ctx.addIssue({ code: "custom", path: ["to"], message: "to must be on or after from" });
  });

export const labourHistoryQuerySchema = z
  .strictObject({ from: businessDate.optional(), to: businessDate.optional(), includeDeleted: flag.default(false) })
  .superRefine((q, ctx) => {
    if (q.from && q.to && q.from > q.to) ctx.addIssue({ code: "custom", path: ["to"], message: "to must be on or after from" });
  });
