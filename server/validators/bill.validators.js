import { z } from "zod";
import { BILL_STATUS_VALUES, GSTIN_PATTERN, HSN_PATTERN, LIMITS, MAX_ITEMS_PER_BILL, MAX_QUANTITY_MILLI, MAX_RATE_PAISE, MAX_TAX_RATE_BP, PHONE_PATTERN, STATE_CODE_PATTERN, TAX_MODE_VALUES } from "../constants/bill.js";
import { gstinMatchesState, parseBp, parseMilli, parseRupeesToPaise } from "../utils/billRules.js";
import { isValidBusinessDate } from "../utils/dates.js";

// Request shapes for /api/bills. Strict: unknown fields (totals, tax amounts, status, bill number ...) are rejected, because the
// server calculates every figure itself. A DRAFT may be half-filled, so most fields are optional here; the service checks that
// a bill is complete when it is finalized.
const businessDate = z.string().refine(isValidBusinessDate, "Use a real date in YYYY-MM-DD form");
const text = (max, label) => z.string().trim().max(max, `${label} is too long`);
const number = (label) => z.number({ error: `${label} must be a number` });

const quantity = number("Quantity").refine((q) => parseMilli(q) !== null, "Quantity can have at most 3 decimal places").refine((q) => (parseMilli(q) ?? 0) <= MAX_QUANTITY_MILLI, "Quantity is too large");
const rate = number("Rate").refine((r) => parseRupeesToPaise(r) !== null, "Rate can have at most 2 decimal places").refine((r) => (parseRupeesToPaise(r) ?? 0) <= MAX_RATE_PAISE, "Rate is too large");
const taxRate = number("Tax rate").nullable().refine((t) => t === null || parseBp(t) !== null, "Tax rate can have at most 2 decimal places").refine((t) => t === null || (parseBp(t) ?? 0) <= MAX_TAX_RATE_BP, "Tax rate cannot be more than 100%");

const item = z.strictObject({
  particulars: text(LIMITS.particulars, "Particulars").optional(),
  hsn: z.string().trim().refine((v) => v === "" || HSN_PATTERN.test(v), "HSN/SAC must be 4, 6 or 8 digits").optional(),
  quantity: quantity.optional(),
  unit: text(LIMITS.unit, "Unit").optional(),
  rate: rate.optional(),
  taxRate: taxRate.optional(),
});

const customer = z
  .strictObject({
    name: text(LIMITS.name, "Customer name").optional(),
    address: text(LIMITS.address, "Address").optional(),
    gstin: z.string().trim().toUpperCase().refine((v) => v === "" || GSTIN_PATTERN.test(v), "GSTIN is not in the right format").optional(),
    stateName: text(LIMITS.name, "State name").optional(),
    stateCode: z.string().trim().refine((v) => v === "" || STATE_CODE_PATTERN.test(v), "State code must be a 2-digit code").optional(),
    contact: z.string().trim().refine((v) => v === "" || PHONE_PATTERN.test(v), "Contact number is not valid").optional(),
  })
  .superRefine((c, ctx) => {
    if (!gstinMatchesState(c.gstin, c.stateCode)) ctx.addIssue({ code: "custom", path: ["stateCode"], message: "The first 2 digits of the GSTIN must match the state code" });
  });

const fields = {
  billDate: businessDate,
  customer,
  taxMode: z.enum(TAX_MODE_VALUES),
  items: z.array(item).max(MAX_ITEMS_PER_BILL, `A bill can have at most ${MAX_ITEMS_PER_BILL} items`),
  notes: text(LIMITS.notes, "Notes"),
};
const reason = z.string().trim().min(3, "Please give a reason").max(LIMITS.reason, "Reason is too long");
const revision = z.number().int().positive();

export const idParamsSchema = z.strictObject({ id: z.string().regex(/^[0-9a-f]{24}$/, "Not a valid bill id") });
export const createBillSchema = z.strictObject({ ...fields, billDate: fields.billDate.optional(), customer: fields.customer.optional(), taxMode: fields.taxMode.optional(), items: fields.items.optional(), notes: fields.notes.optional() });
export const updateBillSchema = z
  .strictObject({ billDate: fields.billDate.optional(), customer: fields.customer.optional(), taxMode: fields.taxMode.optional(), items: fields.items.optional(), notes: fields.notes.optional(), revision: revision.optional() })
  .refine((b) => Object.keys(b).some((k) => k !== "revision"), { path: ["customer"], message: "Send at least one field to change" });
export const finalizeSchema = z.strictObject({ reviewed: z.literal(true, { error: "Confirm that you have reviewed the bill and its tax treatment (reviewed: true)" }), revision: revision.optional() });
export const cancelSchema = z.strictObject({ reason });
export const discardSchema = z.strictObject({ reason: reason.optional() });

export const listQuerySchema = z.strictObject({
  search: z.string().trim().max(60).optional(),
  status: z.enum(BILL_STATUS_VALUES).optional(),
  date: businessDate.optional(),
  from: businessDate.optional(),
  to: businessDate.optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
}).superRefine((q, ctx) => {
  if (q.date && (q.from || q.to)) ctx.addIssue({ code: "custom", path: ["date"], message: "Use either date or from/to, not both" });
  if (q.from && q.to && q.to < q.from) ctx.addIssue({ code: "custom", path: ["to"], message: "to must be on or after from" });
});
export const pdfQuerySchema = z.strictObject({ download: z.enum(["0", "1"]).optional() });
