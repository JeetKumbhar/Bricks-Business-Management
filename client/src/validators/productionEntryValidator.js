import { z } from "zod";
import { toISODate } from "../utils/formatDate";
import { validatePhysicalBricks } from "../utils/productionCalculations";

/**
 * Patlavale production entry form.
 * - bricks: whole number of 1 or more (see validatePhysicalBricks)
 * - date: not in the future ("not before the team's joining date" is checked by the form, which knows the team)
 * - reason: required when correcting an existing entry
 * There are no derived fields here: carry, groups, payable bricks and earnings are always calculated, never typed.
 */
export const makeProductionEntrySchema = ({ isEdit = false } = {}) =>
  z
    .object({
      teamId: z.string().min(1, "Select a Patlavale family / team"),
      date: z.string().min(1, "Date is required"),
      bricks: z.string().trim(),
      note: z.string().trim().max(200, "Note is too long"),
      reason: z.string().trim().max(200, "Reason is too long"),
    })
    .superRefine((values, ctx) => {
      const problem = validatePhysicalBricks(values.bricks);
      if (problem) ctx.addIssue({ code: "custom", path: ["bricks"], message: problem });
      if (values.date && values.date > toISODate()) {
        ctx.addIssue({ code: "custom", path: ["date"], message: "Date cannot be in the future" });
      }
      if (isEdit && values.reason.length < 3) {
        ctx.addIssue({ code: "custom", path: ["reason"], message: "Please give a reason for the correction" });
      }
    })
    .transform((values) => ({ ...values, bricks: Number(values.bricks) }));
