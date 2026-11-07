import * as trips from "../services/truckTrip.service.js";
import { sendSuccess } from "../utils/apiResponse.js";

// Thin: the router has already authenticated and validated; the service holds the rules.

export const list = async (req, res) => {
  const { items, page, limit, total, summary } = await trips.listTrips(req.query);
  return sendSuccess(res, { message: "Pheera records fetched successfully", data: items, meta: { page, limit, total, summary } });
};
export const day = async (req, res) => sendSuccess(res, { message: "Pheera records fetched successfully", data: await trips.getDay(req.query) });
export const options = async (_req, res) => sendSuccess(res, { message: "Options fetched successfully", data: await trips.getOptions() });
export const getOne = async (req, res) => sendSuccess(res, { message: "Pheera record fetched successfully", data: await trips.getTrip(req.params.id) });

/** One Pheera. */
export const create = async (req, res) => {
  const { truckId, businessDate, submissionId, ...row } = req.body;
  const { records, duplicate } = await trips.createTrips({ truckId, businessDate, submissionId, rows: [row] }, req.user);
  return sendSuccess(res, { statusCode: duplicate ? 200 : 201, message: duplicate ? "Pheera was already saved" : "Pheera saved successfully", data: records[0], meta: { duplicate } });
};

/** Several Pheera for one truck and date: 201 with the new records, or 200 with the original records when the submissionId was already saved. */
export const batch = async (req, res) => {
  const { truckId, businessDate, submissionId, trips: rows } = req.body;
  const { records, duplicate } = await trips.createTrips({ truckId, businessDate, submissionId, rows }, req.user);
  return sendSuccess(res, {
    statusCode: duplicate ? 200 : 201,
    message: duplicate ? "These Pheera were already saved" : `${records.length} Pheera saved successfully`,
    data: records,
    meta: { duplicate, summary: trips.summaryDto(records) },
  });
};

export const correct = async (req, res) => sendSuccess(res, { message: "Pheera corrected successfully", data: await trips.correctTrip(req.params.id, req.body, req.user) });
export const voidOne = async (req, res) => sendSuccess(res, { message: "Pheera voided successfully", data: await trips.voidTrip(req.params.id, req.body, req.user) });
