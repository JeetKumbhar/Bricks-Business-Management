import { z } from "zod";
import { LABOUR_TYPES, LABOUR_TYPE_META } from "../utils/labourTypes";
import { LABOUR_STATUS } from "../utils/labourStatus";

/**
 * Add / Edit labour form (all three types).
 * The form has ONE `rate` field; which record field it ends up in (dailyRate, ratePerMaap or
 * ratePer1000PayableBricks) is decided by `labourType` in toLabourInput(), so a rate typed for one
 * type can never land in another type's field.
 * Labour ID is auto-generated and not part of the form values.
 */
export const labourSchema = z
  .object({
    labourType: z.enum([LABOUR_TYPES.BIGARI, LABOUR_TYPES.MAAPVALI, LABOUR_TYPES.PATLAVALE]),
    name: z.string().trim().min(2, "Name is required").max(60, "Name is too long"),
    mobile: z
      .string()
      .trim()
      .regex(/^[6-9]\d{9}$/, "Enter a valid 10-digit mobile number"),
    village: z.string().trim().min(1, "Village is required").max(60, "Village name is too long"),
    joiningDate: z.string().min(1, "Joining date is required"),
    rate: z.string().trim(),
    status: z.enum([LABOUR_STATUS.ACTIVE, LABOUR_STATUS.INACTIVE]),
  })
  .superRefine((values, ctx) => {
    const meta = LABOUR_TYPE_META[values.labourType];
    const rate = Number(values.rate);
    if (values.rate === "") {
      ctx.addIssue({ code: "custom", path: ["rate"], message: `Enter the ${meta.rateLabel.toLowerCase()}` });
    } else if (!Number.isFinite(rate) || rate <= 0) {
      ctx.addIssue({ code: "custom", path: ["rate"], message: `${meta.rateLabel} must be greater than 0` });
    }
  })
  .transform((values) => ({ ...values, rate: Number(values.rate) }));
