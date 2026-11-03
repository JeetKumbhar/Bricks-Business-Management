import * as attendanceService from "../services/attendance.service.js";
import { sendSuccess } from "../utils/apiResponse.js";

// Thin: the router has already authenticated and validated; the service holds the rules.

/** ?date= one day (all records + counts), or ?from=&to= a paged range. */
export const list = async (req, res) => {
  if (req.query.date) return sendSuccess(res, { message: "Attendance fetched successfully", data: await attendanceService.getDay(req.query.date) });
  const { items, page, limit, total } = await attendanceService.listRange(req.query);
  return sendSuccess(res, { message: "Attendance fetched successfully", data: items, meta: { page, limit, total } });
};

export const saveDay = async (req, res) =>
  sendSuccess(res, { message: "Attendance saved successfully", data: await attendanceService.saveDay(req.params.date, req.body, req.user) });

export const getRecord = async (req, res) =>
  sendSuccess(res, { message: "Attendance record fetched successfully", data: await attendanceService.getRecord(req.params.date, req.params.labourId) });

export const labourHistory = async (req, res) => {
  const { items, totals } = await attendanceService.getLabourHistory(req.params.id, req.query);
  return sendSuccess(res, { message: "Attendance history fetched successfully", data: items, meta: totals });
};
