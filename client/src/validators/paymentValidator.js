import { z } from "zod";
import { PAYMENT_TYPES } from "../utils/paymentTypes";
import { toISODate } from "../utils/formatDate";

const base = z.object({
  labourId: z.string().min(1, "Select a labour"),
  type: z.enum([PAYMENT_TYPES.BOOKING_ADVANCE, PAYMENT_TYPES.SALARY_PAYMENT, PAYMENT_TYPES.OTHER]),
  amount: z
    .string()
    .trim()
    .min(1, "Amount is required")
    .refine((v) => Number.isFinite(Number(v)) && Number(v) > 0, "Amount must be greater than 0")
    .transform(Number),
  date: z.string().min(1, "Date is required"),
  note: z.string().trim().max(200, "Note is too long"),
  reason: z.string().trim().max(200, "Reason is too long"),
});

/**
 * Rules (docs/BUSINESS_RULES.md):
 * - amount > 0, date not in the future
 * - a note is required for "Other" payments
 * - a reason is required when correcting an existing payment (isEdit)
 */
export const makePaymentSchema = ({ isEdit = false } = {}) =>
  base.superRefine((values, ctx) => {
    if (values.type === PAYMENT_TYPES.OTHER && !values.note) {
      ctx.addIssue({ code: "custom", path: ["note"], message: "A note is required for Other payments" });
    }
    if (values.date && values.date > toISODate()) {
      ctx.addIssue({ code: "custom", path: ["date"], message: "Date cannot be in the future" });
    }
    if (isEdit && values.reason.length < 3) {
      ctx.addIssue({ code: "custom", path: ["reason"], message: "Please give a reason for the correction" });
    }
  });
