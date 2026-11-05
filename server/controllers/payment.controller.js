import * as balances from "../services/balance.service.js";
import * as payments from "../services/payment.service.js";
import { sendSuccess } from "../utils/apiResponse.js";

// Thin: the router has already authenticated and validated; the services hold the rules.

export const list = async (req, res) => {
  const { items, page, limit, total, summary } = await payments.listPayments(req.query);
  return sendSuccess(res, { message: "Payments fetched successfully", data: items, meta: { page, limit, total, summary } });
};

/** 201 for a new payment; 200 with meta.replayed when a retried requestId returned the first payment. */
export const create = async (req, res) => {
  const { payment, replayed } = await payments.createPayment(req.body, req.user);
  return sendSuccess(res, { statusCode: replayed ? 200 : 201, message: replayed ? "Payment was already saved" : "Payment saved successfully", data: payment, meta: { replayed } });
};

export const getOne = async (req, res) => sendSuccess(res, { message: "Payment fetched successfully", data: await payments.getPayment(req.params.id) });
export const correct = async (req, res) => sendSuccess(res, { message: "Payment corrected successfully", data: await payments.correctPayment(req.params.id, req.body, req.user) });
export const voidOne = async (req, res) => sendSuccess(res, { message: "Payment voided successfully", data: await payments.voidPayment(req.params.id, req.body, req.user) });

export const recipientHistory = async (req, res) => {
  const { items, summary } = await payments.getRecipientHistory(req.params.id, req.query);
  return sendSuccess(res, { message: "Payment history fetched successfully", data: items, meta: { summary } });
};

export const labourBalance = async (req, res) => sendSuccess(res, { message: "Balance fetched successfully", data: await balances.getBalance(req.params.id) });

export const allBalances = async (req, res) => {
  const { items, totals } = await balances.listBalances(req.query);
  return sendSuccess(res, { message: "Balances fetched successfully", data: items, meta: { totals } });
};
