import * as maapService from "../services/maapEntry.service.js";
import { sendSuccess } from "../utils/apiResponse.js";

// Thin: the router has already authenticated and validated; the service holds the rules.

/** ?date= one day (entries + totals), or ?from=&to= a paged range (totals in meta.summary). */
export const list = async (req, res) => {
  if (req.query.date) return sendSuccess(res, { message: "Maap entries fetched successfully", data: await maapService.getDay(req.query.date, req.query) });
  const { items, page, limit, total, summary } = await maapService.listRange(req.query);
  return sendSuccess(res, { message: "Maap entries fetched successfully", data: items, meta: { page, limit, total, summary } });
};

export const saveDay = async (req, res) =>
  sendSuccess(res, { message: "Maap work saved successfully", data: await maapService.saveDay(req.params.date, req.body, req.user) });

export const getOne = async (req, res) =>
  sendSuccess(res, { message: "Maap entry fetched successfully", data: await maapService.getEntry(req.params.id) });

export const correct = async (req, res) =>
  sendSuccess(res, { message: "Maap entry corrected successfully", data: await maapService.correctEntry(req.params.id, req.body, req.user) });

export const remove = async (req, res) =>
  sendSuccess(res, { message: "Maap entry deleted successfully", data: await maapService.deleteEntry(req.params.id, req.body, req.user) });

export const labourHistory = async (req, res) => {
  const { items, summary } = await maapService.getLabourHistory(req.params.id, req.query);
  return sendSuccess(res, { message: "Maap history fetched successfully", data: items, meta: { summary } });
};
