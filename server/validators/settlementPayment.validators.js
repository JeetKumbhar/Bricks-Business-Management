import { z } from "zod";
import { MAX_NOTE_LENGTH, MAX_PAYMENT_RUPEES, MAX_REFERENCE_LENGTH, PAYMENT_METHOD_VALUES } from "../constants/payments.js";
import { isValidBusinessDate } from "../utils/dates.js";
import { rupeesToPaise } from "../utils/money.js";

const businessDate = z.string().refine(isValidBusinessDate, "Use a real date in YYYY-MM-DD form");
// Settlement payment (S3): a JSON number of rupees (max 2 decimals), the day it was really paid, and a REQUIRED requestId so a retry never pays twice.
// The ledger date, recipient, season and statement are never accepted from the client; they come from the stored statement.
const twoDecimals = (n) => {
  try {
    rupeesToPaise(n);
    return true;
  } catch {
    return false;
  }
};
export const statementParamsSchema = z.strictObject({ id: z.string().regex(/^[0-9a-f]{24}$/, "Not a valid season id"), statementId: z.string().regex(/^[0-9a-f]{24}$/, "Not a valid statement id") });
export const settlementPaymentSchema = z.strictObject({
  amount: z.number({ error: "Amount must be a number" }).positive("Amount must be greater than 0").max(MAX_PAYMENT_RUPEES, `Amount cannot be more than ${MAX_PAYMENT_RUPEES}`).refine(twoDecimals, "Amount can have at most 2 decimal places"),
  paidOn: businessDate,
  method: z.enum(PAYMENT_METHOD_VALUES).default("CASH"),
  reference: z.string().trim().max(MAX_REFERENCE_LENGTH, "Reference is too long").optional(),
  note: z.string().trim().max(MAX_NOTE_LENGTH, "Note is too long").optional(),
  requestId: z.string({ error: "requestId is required" }).regex(/^[A-Za-z0-9_-]{8,64}$/, "requestId must be 8 to 64 letters, digits, - or _"),
});
// Carry-forward: both a reason and an explicit confirmation, so it can never happen by accident.
export const carryForwardSchema = z.strictObject({
  reason: z.string().trim().min(3, "Please give a reason").max(200, "Reason is too long"),
  confirm: z.literal(true, { error: "Confirm that this negative balance is carried forward as an outstanding advance" }),
});
