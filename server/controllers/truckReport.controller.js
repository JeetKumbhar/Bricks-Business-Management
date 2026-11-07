import * as reports from "../services/truckReport.service.js";
import { sendSuccess } from "../utils/apiResponse.js";

const send = (message, build) => async (req, res) => sendSuccess(res, { message, data: await build(req) });

export const truck = send("Truck report fetched successfully", (req) => reports.truckReport(req.params.truckId, req.query));
export const daily = send("Daily report fetched successfully", (req) => reports.dailyReport(req.query));
export const range = send("Date-range report fetched successfully", (req) => reports.rangeReport(req.query));
export const material = send("Material-wise report fetched successfully", (req) => reports.materialReport(req.query));
export const destination = send("Destination-wise report fetched successfully", (req) => reports.destinationReport(req.query));
export const allTrucks = send("All-trucks report fetched successfully", (req) => reports.allTrucksReport(req.query));
