import { z } from "zod";
import { LABOUR_ID_PATTERN } from "../constants/labour.js";
import { isValidBusinessDate } from "../utils/dates.js";

// Salary is read-only. The period is just a date range; both ends are optional (no from = from the beginning, no to = today).
const businessDate = z.string().refine(isValidBusinessDate, "Use a real date in YYYY-MM-DD form");
const rangeOrder = (q, ctx) => {
  if (q.from && q.to && q.from > q.to) ctx.addIssue({ code: "custom", path: ["to"], message: "to must be on or after from" });
};

export const labourParamsSchema = z.strictObject({ labourId: z.string().regex(LABOUR_ID_PATTERN, "Not a valid labour id") });
export const summaryQuerySchema = z
  .strictObject({ from: businessDate.optional(), to: businessDate.optional(), labourType: z.enum(["BIGARI", "MAAPVALI", "PATLAVALE"]).optional(), status: z.enum(["ACTIVE", "INACTIVE"]).optional() })
  .superRefine(rangeOrder);
export const statementQuerySchema = z.strictObject({ from: businessDate.optional(), to: businessDate.optional() }).superRefine(rangeOrder);
