import * as labourService from "../services/labour.service.js";
import { sendCreated, sendSuccess } from "../utils/apiResponse.js";

// Thin: the router has already authenticated and validated; the service holds the rules.

export const list = async (req, res) => {
  const { items, page, limit, total } = await labourService.listLabours(req.query);
  return sendSuccess(res, { message: "Labours fetched successfully", data: items, meta: { page, limit, total } });
};

export const summary = async (_req, res) =>
  sendSuccess(res, { message: "Labour summary fetched successfully", data: await labourService.getLabourSummary() });

export const getOne = async (req, res) =>
  sendSuccess(res, { message: "Labour fetched successfully", data: await labourService.getLabour(req.params.id) });

export const create = async (req, res) =>
  sendCreated(res, { message: "Labour created successfully", data: await labourService.createLabour(req.body, req.user) });

export const update = async (req, res) =>
  sendSuccess(res, { message: "Labour updated successfully", data: await labourService.updateLabour(req.params.id, req.body, req.user) });

export const listRates = async (req, res) =>
  sendSuccess(res, { message: "Rate history fetched successfully", data: await labourService.listRateHistory(req.params.id) });

export const addRate = async (req, res) =>
  sendCreated(res, { message: "Rate changed successfully", data: await labourService.changeRate(req.params.id, req.body, req.user) });
