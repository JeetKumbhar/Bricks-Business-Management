import { z } from "zod";
import { validateMaapCount } from "../utils/workCalculations";
import { toISODate } from "../utils/formatDate";

/**
 * Maapvali work entry form.
 * - maaps: whole number of 1 or more (see validateMaapCount for the rule and its status)
 * - date: not in the future (the "not before joining date" check needs the worker, so the form does it)
 * - reason: required when correcting an existing entry
 * There is no rate field: the rate always comes from the worker's profile. A different rate for one entry would be
 * a business decision that has not been made.
 */
export const makeMaapEntrySchema = ({ isEdit = false } = {}) =>
  z
    .object({
      labourId: z.string().min(1, "Select a Maapvali worker"),
      date: z.string().min(1, "Date is required"),
      maaps: z.string().trim(),
      note: z.string().trim().max(200, "Note is too long"),
      reason: z.string().trim().max(200, "Reason is too long"),
    })
    .superRefine((values, ctx) => {
      const maapError = validateMaapCount(values.maaps);
      if (maapError) ctx.addIssue({ code: "custom", path: ["maaps"], message: maapError });
      if (values.date && values.date > toISODate()) {
        ctx.addIssue({ code: "custom", path: ["date"], message: "Date cannot be in the future" });
      }
      if (isEdit && values.reason.length < 3) {
        ctx.addIssue({ code: "custom", path: ["reason"], message: "Please give a reason for the correction" });
      }
    })
    .transform((values) => ({ ...values, maaps: Number(values.maaps) }));
