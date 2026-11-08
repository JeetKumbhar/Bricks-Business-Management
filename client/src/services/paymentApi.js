// Payments and Salary requests. Names and shapes come from server/routes/payment.routes.js, server/validators/payment.validators.js
// and server/routes/salary.routes.js. Money is sent in rupees as a JSON number (the server converts to paise); the server decides
// the recipient type, who made the payment, duplicates and every balance.
import { api } from "./api";

const ALL_TIME_START = "0000-01-01"; // the Salary page's "Season to date": the server's default range, so it is left out of the request

/** A fresh id for one "Add payment" attempt. Sent with the payment so that a retried or double-clicked save can never record it twice. */
export const makeRequestId = () => {
  const raw = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}-${Math.random().toString(36).slice(2, 12)}`;
  return raw.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64);
};

/** values: { labourId, type, amount, date, note }. Resolves the saved payment (the first one if this requestId was already saved). */
export const createPaymentRequest = async (values, requestId) =>
  (await api.post("/payments", { recipientId: values.labourId, type: values.type, amount: Number(values.amount), date: values.date, note: values.note ?? "", requestId })).data;

/** The recipient never changes. The server keeps the old values (who / when / why) in the payment's revisions. */
export const correctPaymentRequest = async (id, { type, amount, date, note }, reason) =>
  (await api.patch(`/payments/${id}`, { type, amount: Number(amount), date, note: note ?? "", reason })).data;

/** Void (the "Delete" button): the payment stays on record with who, when and why, and no balance counts it. */
export const voidPaymentRequest = async (id, reason) => (await api.delete(`/payments/${id}`, { reason })).data;

/** One payment with its revisions (the list endpoint does not carry them). */
export const getPaymentDetail = async (id) => (await api.get(`/payments/${id}`)).data;

/**
 * Salary for a date range, calculated by the server. The server answers { data: [one row per labour], meta: { range, summary } };
 * this resolves { range, items, summary } (summary: { byType, total }).
 */
export const getSalary = async ({ from, to } = {}, { signal } = {}) => {
  const res = await api.get("/salary", { query: { from: from && from !== ALL_TIME_START ? from : undefined, to }, signal });
  if (!Array.isArray(res.data) || !res.meta?.summary) throw new Error("The server's salary answer was not in the expected form.");
  return { range: res.meta.range, items: res.data, summary: res.meta.summary };
};
