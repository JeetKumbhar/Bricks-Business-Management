import { z } from "zod";
import { toISODate } from "../utils/formatDate";
import { validateMaapCount } from "../utils/workCalculations";

/**
 * Patlavale production correction form (new production is entered on the daily list).
 * - maaps: whole number of 0 or more (0 = the owner recorded no production that day)
 * - date: not in the future ("not before the team's joining date" is checked by the form, which knows the team)
 * - reason: required when correcting an existing entry
 * There are no derived fields here: payable bricks and earnings are always calculated, never typed.
 */
export const makeProductionEntrySchema = ({ isEdit = false } = {}) =>
  z
    .object({
      teamId: z.string().min(1, "Select a Patlavale family / team"),
      date: z.string().min(1, "Date is required"),
      maaps: z.string().trim(),
      note: z.string().trim().max(200, "Note is too long"),
      reason: z.string().trim().max(200, "Reason is too long"),
    })
    .superRefine((values, ctx) => {
      const problem = validateMaapCount(values.maaps);
      if (problem) ctx.addIssue({ code: "custom", path: ["maaps"], message: problem });
      if (values.date && values.date > toISODate()) {
        ctx.addIssue({ code: "custom", path: ["date"], message: "Date cannot be in the future" });
      }
      if (isEdit && values.reason.length < 3) {
        ctx.addIssue({ code: "custom", path: ["reason"], message: "Please give a reason for the correction" });
      }
    })
    .transform((values) => ({ ...values, maaps: Number(values.maaps) }));
