import { z } from "zod";
import { LABOUR_ID_PATTERN } from "../constants/labour.js";
import { MAX_MAAPS_PER_ENTRY, MAX_NOTE_LENGTH, MAX_ROWS_PER_SAVE } from "../constants/production.js";
import { isValidBusinessDate } from "../utils/dates.js";

// Request shapes for /api/production-entries. They match the frontend's saveProductionDay(date, rows, reason) and
// updateProductionEntry(id, { date, newMaaps, note }, reason). Strict: a rate, bricks, earnings or season id is never
// accepted from the client (all derived on the server).
const businessDate = z.string().refine(isValidBusinessDate, "Use a real date in YYYY-MM-DD form");
const teamId = z.string().regex(LABOUR_ID_PATTERN, "Not a valid team id");
const objectId = (label) => z.string().regex(/^[0-9a-f]{24}$/, `Not a valid ${label} id`);
const maaps = z.number({ error: "Maaps must be a number" }).int("Maaps must be a whole number").min(0, "Maaps cannot be negative").max(MAX_MAAPS_PER_ENTRY, `Maaps cannot be more than ${MAX_MAAPS_PER_ENTRY}`);
const note = z.string().trim().max(MAX_NOTE_LENGTH, "Note is too long");
const reason = z.string().trim().min(3, "Please give a reason").max(200, "Reason is too long");

export const dateParamsSchema = z.strictObject({ date: businessDate });
export const idParamsSchema = z.strictObject({ id: objectId("entry") });
export const teamParamsSchema = z.strictObject({ id: teamId });

export const saveDaySchema = z
  .strictObject({
    rows: z.array(z.strictObject({ teamId, maaps, note: note.optional() })).min(1, "Send at least one row").max(MAX_ROWS_PER_SAVE, `At most ${MAX_ROWS_PER_SAVE} rows per save`),
    reason: reason.optional(),
  })
  .superRefine((body, ctx) => {
    const seen = new Set();
    body.rows.forEach((row, i) => {
      if (seen.has(row.teamId)) ctx.addIssue({ code: "custom", path: ["rows", i, "teamId"], message: "This team appears more than once" });
      seen.add(row.teamId);
    });
  });

export const correctionSchema = z
  .strictObject({ date: businessDate.optional(), newMaaps: maaps.optional(), note: note.optional(), reason })
  .refine((b) => b.date !== undefined || b.newMaaps !== undefined || b.note !== undefined, { path: ["newMaaps"], message: "Send at least one field to change" });

export const deleteSchema = z.strictObject({ reason });

const flag = z.enum(["true", "false"]).transform((v) => v === "true");
const rangeOrder = (q, ctx) => {
  if (q.from && q.to && q.from > q.to) ctx.addIssue({ code: "custom", path: ["to"], message: "to must be on or after from" });
};

// One day (?date=) OR a range (?from=&to=) OR one season (?seasonId=); optionally one team; voided entries only when asked for.
export const listQuerySchema = z
  .strictObject({
    date: businessDate.optional(),
    from: businessDate.optional(),
    to: businessDate.optional(),
    teamId: teamId.optional(),
    seasonId: objectId("season").optional(),
    includeDeleted: flag.default(false),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(500).default(100),
  })
  .superRefine((q, ctx) => {
    if (!q.date && !q.from && !q.to && !q.seasonId) ctx.addIssue({ code: "custom", path: ["date"], message: "Give a date, a from / to range, or a seasonId" });
    if (q.date && (q.from || q.to)) ctx.addIssue({ code: "custom", path: ["date"], message: "Use either date or from / to, not both" });
    rangeOrder(q, ctx);
  });

export const teamHistoryQuerySchema = z
  .strictObject({ from: businessDate.optional(), to: businessDate.optional(), seasonId: objectId("season").optional(), includeDeleted: flag.default(false) })
  .superRefine(rangeOrder);
