import { z } from "zod";

/** Change-rate form. newRate is typed as text and converted to a number. */
export const rateChangeSchema = z.object({
  newRate: z
    .string()
    .trim()
    .min(1, "New rate is required")
    .refine((v) => Number.isFinite(Number(v)) && Number(v) > 0, "Rate must be greater than 0")
    .transform(Number),
  effectiveFrom: z.string().min(1, "Effective date is required"),
  reason: z.string().trim().min(3, "Please give a reason").max(200, "Reason is too long"),
});
