import * as production from "../services/productionEntry.service.js";
import { sendSuccess } from "../utils/apiResponse.js";

// Thin: the router has already authenticated and validated; the service holds the rules.

/** ?date= one day (entries + totals), or ?from=&to= / ?seasonId= a paged list (totals in meta.summary). */
export const list = async (req, res) => {
  if (req.query.date) return sendSuccess(res, { message: "Production entries fetched successfully", data: await production.getDay(req.query.date, req.query) });
  const { items, page, limit, total, summary } = await production.listRange(req.query);
  return sendSuccess(res, { message: "Production entries fetched successfully", data: items, meta: { page, limit, total, summary } });
};

export const saveDay = async (req, res) =>
  sendSuccess(res, { message: "Production saved successfully", data: await production.saveDay(req.params.date, req.body, req.user) });

export const getOne = async (req, res) =>
  sendSuccess(res, { message: "Production entry fetched successfully", data: await production.getEntry(req.params.id) });

export const correct = async (req, res) =>
  sendSuccess(res, { message: "Production entry corrected successfully", data: await production.correctEntry(req.params.id, req.body, req.user) });

export const remove = async (req, res) =>
  sendSuccess(res, { message: "Production entry deleted successfully", data: await production.deleteEntry(req.params.id, req.body, req.user) });

export const teamHistory = async (req, res) => {
  const { items, summary } = await production.getTeamHistory(req.params.id, req.query);
  return sendSuccess(res, { message: "Production history fetched successfully", data: items, meta: { summary } });
};
