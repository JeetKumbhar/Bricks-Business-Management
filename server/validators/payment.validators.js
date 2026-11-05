import { z } from "zod";
import { LABOUR_ID_PATTERN } from "../constants/labour.js";
import { MAX_NOTE_LENGTH, MAX_PAYMENT_RUPEES, MAX_REFERENCE_LENGTH, PAYMENT_METHOD_VALUES, PAYMENT_TYPE_VALUES, PAYMENT_TYPES } from "../constants/payments.js";
import { isValidBusinessDate } from "../utils/dates.js";
import { rupeesToPaise } from "../utils/money.js";

// Request shapes for /api/payments. Strict: unknown fields are rejected. The recipient type, the paise amount, who made
// the payment and the balance are never accepted from the client. Whether a date is in the future depends on the clock,
// and whether it is before joining depends on the recipient, so the service checks those.
const businessDate = z.string().refine(isValidBusinessDate, "Use a real date in YYYY-MM-DD form");
const recipientId = z.string().regex(LABOUR_ID_PATTERN, "Not a valid recipient id");
const paymentId = z.string().regex(/^[0-9a-f]{24}$/, "Not a valid payment id");
const twoDecimals = (n) => {
  try {
    rupeesToPaise(n);
    return true;
  } catch {
    return false;
  }
};
// A JSON number, not text: "500" is rejected.
const amount = z
  .number({ error: "Amount must be a number" })
  .positive("Amount must be greater than 0")
  .max(MAX_PAYMENT_RUPEES, `Amount cannot be more than ${MAX_PAYMENT_RUPEES}`)
  .refine(twoDecimals, "Amount can have at most 2 decimal places");
const type = z.enum(PAYMENT_TYPE_VALUES);
const method = z.enum(PAYMENT_METHOD_VALUES);
const note = z.string().trim().max(MAX_NOTE_LENGTH, "Note is too long");
const reference = z.string().trim().max(MAX_REFERENCE_LENGTH, "Reference is too long");
const reason = z.string().trim().min(3, "Please give a reason").max(200, "Reason is too long");
const requestId = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/, "requestId must be 8 to 64 letters, digits, - or _");

export const idParamsSchema = z.strictObject({ id: paymentId });
export const labourParamsSchema = z.strictObject({ id: recipientId });

export const createPaymentSchema = z
  .strictObject({ recipientId, type, amount, date: businessDate, method: method.default("CASH"), reference: reference.optional(), note: note.default(""), requestId: requestId.optional() })
  .superRefine((p, ctx) => {
    if (p.type === PAYMENT_TYPES.OTHER && !p.note) ctx.addIssue({ code: "custom", path: ["note"], message: "A note is required for Other payments" });
  });

// Correction: the recipient never changes (a payment to the wrong person is voided and entered again). A reason is always required.
export const correctionSchema = z
  .strictObject({ type: type.optional(), amount: amount.optional(), date: businessDate.optional(), method: method.optional(), reference: reference.optional(), note: note.optional(), reason })
  .refine((b) => Object.keys(b).some((k) => k !== "reason"), { path: ["amount"], message: "Send at least one field to change" });

export const voidSchema = z.strictObject({ reason });

const flag = z.enum(["true", "false"]).transform((v) => v === "true");
const rangeOrder = (q, ctx) => {
  if (q.from && q.to && q.from > q.to) ctx.addIssue({ code: "custom", path: ["to"], message: "to must be on or after from" });
};

export const listQuerySchema = z
  .strictObject({
    recipientId: recipientId.optional(),
    type: type.optional(),
    from: businessDate.optional(),
    to: businessDate.optional(),
    includeDeleted: flag.default(false),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(500).default(100),
  })
  .superRefine(rangeOrder);

export const recipientHistoryQuerySchema = z
  .strictObject({ type: type.optional(), from: businessDate.optional(), to: businessDate.optional(), includeDeleted: flag.default(false) })
  .superRefine(rangeOrder);

export const balancesQuerySchema = z.strictObject({ labourType: z.enum(["BIGARI", "MAAPVALI", "PATLAVALE"]).optional(), status: z.enum(["ACTIVE", "INACTIVE"]).optional() });
