import { z } from "zod";
import { CUSTOMER_KIND_VALUES, CUSTOMER_LIMITS } from "../constants/customer.js";
import { GSTIN_PATTERN, PHONE_PATTERN, STATE_CODE_PATTERN } from "../constants/bill.js";
import { gstinMatchesState } from "../utils/billRules.js";

// Request shapes for /api/customers. Strict: unknown fields (kind, customerKey, status ...) are rejected.
const name = z.string().trim().min(CUSTOMER_LIMITS.nameMin, "Enter the customer name").max(CUSTOMER_LIMITS.nameMax, "Customer name is too long");
const detail = {
  address: z.string().trim().max(CUSTOMER_LIMITS.address, "Address is too long"),
  gstin: z.string().trim().toUpperCase().refine((v) => v === "" || GSTIN_PATTERN.test(v), "GSTIN is not in the right format"),
  stateName: z.string().trim().max(CUSTOMER_LIMITS.nameMax, "State name is too long"),
  stateCode: z.string().trim().refine((v) => v === "" || STATE_CODE_PATTERN.test(v), "State code must be a 2-digit code"),
  contact: z.string().trim().refine((v) => v === "" || PHONE_PATTERN.test(v), "Contact number is not valid"),
};
const gstinState = (c, ctx) => {
  if (!gstinMatchesState(c.gstin, c.stateCode)) ctx.addIssue({ code: "custom", path: ["stateCode"], message: "The first 2 digits of the GSTIN must match the state code" });
};
const reason = z.string().trim().min(3, "Please give a reason").max(CUSTOMER_LIMITS.reason, "Reason is too long");
const revision = z.number().int().positive();
const flag = z.enum(["true", "false"]).transform((v) => v === "true");

export const idParamsSchema = z.strictObject({ id: z.string().regex(/^[0-9a-f]{24}$/, "Not a valid customer id") });
export const createCustomerSchema = z.strictObject({ name, address: detail.address.optional(), gstin: detail.gstin.optional(), stateName: detail.stateName.optional(), stateCode: detail.stateCode.optional(), contact: detail.contact.optional() }).superRefine(gstinState);
export const updateCustomerSchema = z
  .strictObject({ name: name.optional(), address: detail.address.optional(), gstin: detail.gstin.optional(), stateName: detail.stateName.optional(), stateCode: detail.stateCode.optional(), contact: detail.contact.optional(), revision: revision.optional() })
  .refine((b) => Object.keys(b).some((k) => k !== "revision"), { path: ["name"], message: "Send at least one field to change" })
  .superRefine(gstinState);
export const archiveSchema = z.strictObject({ reason });
export const restoreSchema = z.strictObject({ reason: reason.optional() });
export const listQuerySchema = z.strictObject({
  search: z.string().trim().max(60).optional(),
  kind: z.enum(CUSTOMER_KIND_VALUES).optional(),
  includeArchived: flag.default(false),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});
