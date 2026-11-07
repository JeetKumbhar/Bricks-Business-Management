import { z } from "zod";
import { GSTIN_PATTERN, IFSC_PATTERN, LIMITS, MAX_TAX_RATE_BP, PAN_PATTERN, PHONE_PATTERN, STATE_CODE_PATTERN, TAX_MODE_VALUES } from "../constants/bill.js";
import { gstinMatchesState, parseBp } from "../utils/billRules.js";

// PATCH /api/invoice-settings: send only what changes. Empty text clears a field. Shapes are checked here; the business
// owner is responsible for the real GSTIN, PAN, bank and tax treatment.
const optionalPattern = (re, message, transform = (s) => s) => z.string().trim().transform(transform).refine((v) => v === "" || re.test(v), message);
const text = (max) => z.string().trim().max(max);

export const updateSettingsSchema = z
  .strictObject({
    businessName: text(LIMITS.name).min(2, "Business name is required").optional(),
    businessDescription: text(LIMITS.description).optional(),
    productsLine: text(LIMITS.address).optional(),
    gstin: optionalPattern(GSTIN_PATTERN, "GSTIN is not in the right format", (s) => s.toUpperCase()).optional(),
    pan: optionalPattern(PAN_PATTERN, "PAN is not in the right format", (s) => s.toUpperCase()).optional(),
    address: text(LIMITS.address).optional(),
    phones: z.array(z.string().trim().regex(PHONE_PATTERN, "Phone number is not valid")).max(4).optional(),
    jurisdiction: text(LIMITS.name).optional(),
    stateName: text(LIMITS.name).optional(),
    stateCode: optionalPattern(STATE_CODE_PATTERN, "State code must be a 2-digit code").optional(),
    bank: z.strictObject({ bankName: text(LIMITS.name).optional(), branch: text(LIMITS.name).optional(), accountNumber: z.string().trim().regex(/^[0-9A-Za-z]{0,30}$/, "Account number can have letters and digits only").optional(), ifsc: optionalPattern(IFSC_PATTERN, "IFSC is not in the right format", (s) => s.toUpperCase()).optional() }).optional(),
    proprietorName: text(LIMITS.name).optional(),
    numbering: z
      .strictObject({ prefix: z.string().trim().regex(/^[A-Za-z0-9]{0,10}$/, "Prefix can have letters and digits only").optional(), separator: z.enum(["", "/", "-"]).optional(), includeFinancialYear: z.boolean().optional(), padding: z.number().int().min(1).max(8).optional() })
      .optional(),
    defaultTaxMode: z.enum(TAX_MODE_VALUES).optional(),
    allowedTaxRates: z.array(z.number().refine((t) => parseBp(t) !== null && parseBp(t) <= MAX_TAX_RATE_BP, "Tax rate must be 0 to 100 with at most 2 decimals")).max(20).optional(),
    units: z.array(z.string().trim().min(1).max(LIMITS.unit)).max(30).optional(),
  })
  .refine((b) => Object.keys(b).length > 0, { path: ["businessName"], message: "Send at least one field to change" })
  .superRefine((b, ctx) => {
    if (!gstinMatchesState(b.gstin, b.stateCode)) ctx.addIssue({ code: "custom", path: ["stateCode"], message: "The first 2 digits of the GSTIN must match the state code" });
  });
