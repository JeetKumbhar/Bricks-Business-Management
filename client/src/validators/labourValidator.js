import { z } from "zod";
import { LABOUR_STATUS } from "../utils/labourStatus";

/**
 * Add / Edit labour form.
 * Labour ID is auto-generated, so it is not part of the form values.
 * dailyRate is typed as text in the form and converted to a number here.
 */
export const labourSchema = z.object({
  name: z.string().trim().min(2, "Name is required").max(60, "Name is too long"),
  mobile: z
    .string()
    .trim()
    .regex(/^[6-9]\d{9}$/, "Enter a valid 10-digit mobile number"),
  village: z.string().trim().min(1, "Village is required").max(60, "Village name is too long"),
  joiningDate: z.string().min(1, "Joining date is required"),
  dailyRate: z
    .string()
    .trim()
    .min(1, "Daily rate is required")
    .refine((v) => Number.isFinite(Number(v)) && Number(v) > 0, "Daily rate must be greater than 0")
    .transform(Number),
  status: z.enum([LABOUR_STATUS.ACTIVE, LABOUR_STATUS.INACTIVE]),
});
