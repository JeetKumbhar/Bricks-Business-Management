import { DUPLICATE_WINDOW_MS, PAYMENT_TYPES, RECIPIENT_TYPES } from "../constants/payments.js";
import { LABOUR_TYPES } from "../constants/labour.js";
import Labour from "../models/Labour.js";
import Payment from "../models/Payment.js";
import ApiError from "../utils/ApiError.js";
import { isFutureBusinessDate, todayBusinessDate } from "../utils/dates.js";
import { paiseToRupees, rupeesToPaise } from "../utils/money.js";
import { summarizePayments } from "./paymentCalculations.js";

// Payments = money transactions to a worker or a Patlavale team. Rules for this module:
//  - A payment is a financial record only. This module never reads or writes attendance, maap entries or production.
//  - The recipient is fixed at creation (a payment to the wrong person is voided and entered again).
//  - Nothing is erased. A correction keeps the old values (who, when, why). A wrong payment is VOIDED (soft delete with a reason)
//    and is left out of every balance but stays in the history.
//  - A retried create is safe: the same requestId returns the first payment instead of making a second. Without a requestId,
//    an identical payment made seconds earlier is refused as a double submit.
//  - Bayana (BOOKING_ADVANCE) may be dated before the joining date; every other type may not.

const fieldError = (status, message, field) => new ApiError(status, message, [{ field, message }]);
const isDuplicateKey = (err) => err?.code === 11000;
const live = { isDeleted: false };

// ---------- Output shapes (the frontend's own field names; money in rupees) ----------

export const toPaymentDto = (row) => ({
  id: String(row._id),
  recipientType: row.recipientType,
  recipientId: row.recipientId,
  labourId: row.recipientId, // legacy alias the frontend still reads
  type: row.type,
  isAdvance: row.type === PAYMENT_TYPES.BOOKING_ADVANCE,
  amount: paiseToRupees(row.amountPaise),
  date: row.date,
  method: row.method,
  reference: row.reference ?? "",
  note: row.note ?? "",
  revision: row.revision ?? 1,
  corrected: (row.revision ?? 1) > 1,
  isDeleted: Boolean(row.isDeleted),
  ...(row.isDeleted ? { deletedReason: row.deletedReason, deletedAt: row.deletedAt, deletedBy: row.deletedBy } : {}),
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

const toDetailDto = (row) => ({
  ...toPaymentDto(row),
  revisions: (row.history ?? []).map(({ at, by, reason, before }) => ({
    at,
    by,
    reason,
    before: { type: before.type, amount: paiseToRupees(before.amountPaise), date: before.date, method: before.method, reference: before.reference ?? "", note: before.note ?? "" },
  })),
});

export const toSummaryDto = (rows) => {
  const s = summarizePayments(rows);
  return { payments: s.payments, bayana: paiseToRupees(s.bayanaPaise), salaryPayments: paiseToRupees(s.salaryPaise), otherPayments: paiseToRupees(s.otherPaise), totalReceived: paiseToRupees(s.totalReceivedPaise), notCounted: paiseToRupees(s.notCountedPaise) };
};

const newestFirst = (a, b) => b.date.localeCompare(a.date) || String(b.createdAt).localeCompare(String(a.createdAt));
const stateFilter = (includeDeleted) => (includeDeleted ? {} : live);
const dateRange = (from, to) => (from || to ? { date: { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) } } : {});
const filtersOf = ({ recipientId, type, from, to, includeDeleted = false }) => ({ ...stateFilter(includeDeleted), ...dateRange(from, to), ...(recipientId ? { recipientId } : {}), ...(type ? { type } : {}) });

// ---------- Reads ----------

/** Payment history, newest first, paged. `summary` covers every live payment that matches, not only the page. */
export const listPayments = async (query) => {
  const { page = 1, limit = 100 } = query;
  const filter = filtersOf(query);
  const [total, all] = await Promise.all([Payment.countDocuments(filter), Payment.find(filter).lean()]);
  const items = all.sort(newestFirst).slice((page - 1) * limit, page * limit);
  return { items: items.map(toPaymentDto), page, limit, total, summary: toSummaryDto(all.filter((r) => !r.isDeleted)) };
};

const loadPayment = async (id) => {
  const [row] = await Payment.find({ _id: id }).lean();
  if (!row) throw ApiError.notFound("Payment not found");
  return row;
};

/** One payment with its correction trail (`revisions`). */
export const getPayment = async (id) => toDetailDto(await loadPayment(id));

/** One recipient's payment history (any labour type) with totals of their live payments. */
export const getRecipientHistory = async (recipientId, query = {}) => {
  const [labour] = await Labour.find({ _id: recipientId }).lean();
  if (!labour) throw ApiError.notFound("Labour not found");
  const rows = (await Payment.find(filtersOf({ ...query, recipientId })).lean()).sort(newestFirst);
  return { items: rows.map(toPaymentDto), summary: toSummaryDto(rows.filter((r) => !r.isDeleted)) };
};

// ---------- Write: create ----------

const core = (p) => [p.recipientId, p.type, p.amountPaise, p.date].join("|");

const checkRecipientRules = ({ labour, type, date, note, now }) => {
  if (isFutureBusinessDate(date, now)) throw fieldError(400, `The date cannot be in the future (today is ${todayBusinessDate(now)})`, "date");
  if (type !== PAYMENT_TYPES.BOOKING_ADVANCE && labour.joiningDate > date) throw fieldError(400, `Joined on ${labour.joiningDate}. Only a Bayana can be dated before joining.`, "date");
  if (type === PAYMENT_TYPES.OTHER && !note) throw fieldError(400, "A note is required for Other payments", "note");
};

/** Create one payment. Returns { payment, replayed }: replayed is true when a retried requestId returned the first payment. */
export const createPayment = async (input, actor, now = new Date()) => {
  const [labour] = await Labour.find({ _id: input.recipientId }).lean();
  if (!labour) throw fieldError(400, "Recipient not found", "recipientId");
  const note = input.note ?? "";
  checkRecipientRules({ labour, type: input.type, date: input.date, note, now });

  const amountPaise = rupeesToPaise(input.amount);
  const candidate = { recipientId: input.recipientId, type: input.type, amountPaise, date: input.date };
  const requestId = input.requestId ?? null;

  const replay = async () => {
    const [first] = await Payment.find({ requestId }).lean();
    if (!first) return null;
    if (core(first) !== core(candidate)) throw fieldError(409, "This requestId was already used for a different payment", "requestId");
    return { payment: toDetailDto(first), replayed: true };
  };

  if (requestId) {
    const again = await replay();
    if (again) return again;
  } else {
    const recent = (await Payment.find({ ...candidate, ...live }).lean()).find((p) => now.getTime() - new Date(p.createdAt).getTime() < DUPLICATE_WINDOW_MS);
    if (recent) throw fieldError(409, "An identical payment was just saved. Send a requestId to retry safely, or wait a moment if it is a second payment.", "amount");
  }

  const actorId = actor.id ?? null;
  try {
    const created = await Payment.create({
      ...candidate,
      recipientType: labour.labourType === LABOUR_TYPES.PATLAVALE ? RECIPIENT_TYPES.TEAM : RECIPIENT_TYPES.WORKER,
      method: input.method ?? "CASH",
      reference: input.reference ?? "",
      note,
      requestId,
      revision: 1,
      history: [],
      isDeleted: false,
      createdBy: actorId,
      updatedBy: actorId,
    });
    return { payment: toDetailDto(created.toObject()), replayed: false };
  } catch (err) {
    if (isDuplicateKey(err) && requestId) {
      const again = await replay(); // two copies of the same request raced; the loser gets the winner's payment
      if (again) return again;
    }
    throw err;
  }
};

// ---------- Write: correct or void ----------

/** Correct type, amount, date, method, reference and/or note. The recipient never changes. The old values are kept in `revisions`. */
export const correctPayment = async (id, changes, actor, now = new Date()) => {
  const payment = await loadPayment(id);
  if (payment.isDeleted) throw ApiError.conflict("A voided payment cannot be corrected");

  const next = {
    type: changes.type ?? payment.type,
    amountPaise: changes.amount === undefined ? payment.amountPaise : rupeesToPaise(changes.amount),
    date: changes.date ?? payment.date,
    method: changes.method ?? payment.method,
    reference: changes.reference ?? payment.reference ?? "",
    note: changes.note ?? payment.note ?? "",
  };
  const same = Object.keys(next).every((k) => next[k] === (payment[k] ?? ""));
  if (same) return toDetailDto(payment);

  const [labour] = await Labour.find({ _id: payment.recipientId }).lean();
  checkRecipientRules({ labour: labour ?? { joiningDate: "0000-01-01" }, type: next.type, date: next.date, note: next.note, now });

  const actorId = actor.id ?? null;
  const result = await Payment.updateOne(
    { _id: payment._id, revision: payment.revision, ...live },
    {
      $set: { ...next, updatedBy: actorId },
      $inc: { revision: 1 },
      $push: {
        history: {
          at: now,
          by: actor.name,
          byId: actorId,
          reason: changes.reason,
          before: { type: payment.type, amountPaise: payment.amountPaise, date: payment.date, method: payment.method, reference: payment.reference ?? "", note: payment.note ?? "" },
        },
      },
    }
  );
  if (result.matchedCount !== 1) throw ApiError.conflict("This payment was changed by someone else. Reload and try again.");
  return getPayment(id);
};

/** Void (soft delete): the payment stays in the history with who, when and why, and no balance counts it. */
export const voidPayment = async (id, { reason }, actor, now = new Date()) => {
  const payment = await loadPayment(id);
  if (payment.isDeleted) throw ApiError.conflict("This payment is already voided");
  const result = await Payment.updateOne(
    { _id: payment._id, ...live },
    { $set: { isDeleted: true, deletedAt: now, deletedBy: actor.name, deletedReason: reason, updatedBy: actor.id ?? null }, $inc: { revision: 1 } }
  );
  if (result.matchedCount !== 1) throw ApiError.conflict("This payment was changed by someone else. Reload and try again.");
  return getPayment(id);
};
