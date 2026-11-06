import * as salary from "../services/salary.service.js";
import { sendSuccess } from "../utils/apiResponse.js";

export const summary = async (req, res) => {
  const { range, items, summary: totals } = await salary.getSalarySummary(req.query);
  return sendSuccess(res, { message: "Salary fetched successfully", data: items, meta: { range, summary: totals } });
};

export const statement = async (req, res) =>
  sendSuccess(res, { message: "Salary statement fetched successfully", data: await salary.getStatement(req.params.labourId, req.query) });
