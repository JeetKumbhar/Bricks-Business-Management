import { z } from "zod";
import { BRICKS_PER_MAAP, LABOUR_TYPES, PAYABLE_BRICKS_PER_MAAP, RATE_TYPES } from "../utils/labourTypes";
import { PAYMENT_TYPES } from "../utils/paymentTypes";

// Schemas for the stored record shapes (docs/BUSINESS_RULES.md, "Data shapes").
// They validate the mock data now and can be reused for the server later.

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const recordId = z.string().regex(/^L-\d{3,}$/, "Use the form L-001");
const whole = z.number().int().min(0);

const common = {
  id: recordId,
  name: z.string().trim().min(2),
  mobile: z.string().regex(/^[6-9]\d{9}$/, "10-digit mobile number"),
  village: z.string().trim().min(1),
  status: z.enum(["ACTIVE", "INACTIVE"]),
  joiningDate: isoDate,
  photo: z.string().nullable().optional(),
};

// .strict(): a record may only carry the rate field of its own type
// (a Maapvali with a dailyRate, for example, is rejected).
const bigari = z
  .object({ ...common, labourType: z.literal(LABOUR_TYPES.BIGARI), dailyRate: z.number().positive() })
  .strict();

const maapvali = z
  .object({ ...common, labourType: z.literal(LABOUR_TYPES.MAAPVALI), ratePerFourMaaps: z.number().positive() })
  .strict();

// A Patlavale record is the family / team. `name` is the team name.
// `members` is optional reference information only - members are never salary recipients.
const patlavale = z
  .object({
    ...common,
    labourType: z.literal(LABOUR_TYPES.PATLAVALE),
    ratePer1000PayableBricks: z.number().positive(),
    members: z.array(z.object({ name: z.string().trim().min(1), relation: z.string().optional() }).strict()).optional(),
  })
  .strict();

export const labourRecordSchema = z.discriminatedUnion("labourType", [bigari, maapvali, patlavale]);

export const attendanceRecordSchema = z.object({
  id: z.string().min(1),
  labourId: recordId, // Bigari only
  date: isoDate,
  status: z.enum(["PRESENT", "HALF_DAY", "ABSENT"]),
});

export const rateHistoryEntrySchema = z.object({
  id: z.string().min(1),
  labourId: recordId,
  rateType: z.enum([RATE_TYPES.DAILY_RATE, RATE_TYPES.RATE_PER_FOUR_MAAPS, RATE_TYPES.RATE_PER_1000_PAYABLE_BRICKS]),
  rate: z.number().positive(),
  effectiveFrom: isoDate,
  reason: z.string().min(1),
  changedBy: z.string().min(1),
  createdAt: z.string().min(1),
});

// A payment is a money transaction, not a work record.
// recipientType/recipientId say who was paid (a worker, or a Patlavale team).
// `labourId` is a legacy alias of recipientId that existing screens still read; it goes away with the Payments rework.
export const paymentRecordSchema = z
  .object({
    id: z.string().min(1),
    recipientType: z.enum(["WORKER", "TEAM"]),
    recipientId: recordId,
    labourId: recordId,
    date: isoDate,
    type: z.enum([PAYMENT_TYPES.BOOKING_ADVANCE, PAYMENT_TYPES.SALARY_PAYMENT, PAYMENT_TYPES.OTHER]),
    amount: z.number().positive(),
    method: z.enum(["CASH", "UPI", "BANK"]),
    note: z.string(),
    reference: z.string().optional(),
    isDeleted: z.boolean(),
  })
  .superRefine((p, ctx) => {
    if (p.labourId !== p.recipientId) {
      ctx.addIssue({ code: "custom", path: ["labourId"], message: "labourId must equal recipientId" });
    }
  });

// Maapvali daily maap work entry. ratePerFourMaaps is a snapshot of the rate on that day.
// numberOfMaaps is what was entered that day (0 is allowed: an explicit zero). Every maap is paid: earnings = maaps / 4 x rate.
export const maapEntrySchema = z
  .object({
    id: z.string().min(1),
    labourId: recordId,
    seasonId: z.string().min(1),
    date: isoDate,
    numberOfMaaps: whole,
    ratePerFourMaaps: z.number().positive(),
    earnings: z.number().min(0),
    note: z.string(),
  })
  .superRefine((e, ctx) => {
    if (Math.abs(e.earnings - (e.numberOfMaaps / 4) * e.ratePerFourMaaps) > 0.005) {
      ctx.addIssue({ code: "custom", path: ["earnings"], message: "earnings must equal numberOfMaaps / 4 x ratePerFourMaaps" });
    }
  });

// Patlavale production entry. Maaps typed, physical bricks (x275), payable bricks (x250) and earnings are separate values.
export const productionEntrySchema = z
  .object({
    id: z.string().min(1),
    teamId: recordId,
    seasonId: z.string().min(1),
    date: isoDate,
    newMaaps: whole,
    newPhysicalBricks: whole,
    newPayableBricks: whole,
    ratePer1000PayableBricks: z.number().positive(),
    newEarnings: z.number().min(0),
    note: z.string(),
  })
  .superRefine((e, ctx) => {
    const problem = (path, message) => ctx.addIssue({ code: "custom", path: [path], message });
    if (e.newPhysicalBricks !== e.newMaaps * BRICKS_PER_MAAP) problem("newPhysicalBricks", `must be newMaaps x ${BRICKS_PER_MAAP}`);
    if (e.newPayableBricks !== e.newMaaps * PAYABLE_BRICKS_PER_MAAP) problem("newPayableBricks", `must be newMaaps x ${PAYABLE_BRICKS_PER_MAAP}`);
    if (Math.abs(e.newEarnings - (e.newPayableBricks / 1000) * e.ratePer1000PayableBricks) > 0.005) {
      problem("newEarnings", "must be (newPayableBricks / 1000) x ratePer1000PayableBricks");
    }
  });

// Season dates and the closing procedure are still to be confirmed with the client, so dates may be null.
export const seasonSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  startDate: isoDate.nullable(),
  endDate: isoDate.nullable(),
  status: z.enum(["OPEN", "CLOSED"]),
});
