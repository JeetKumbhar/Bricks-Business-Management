import * as settings from "../services/invoiceSettings.service.js";
import { sendSuccess } from "../utils/apiResponse.js";

export const get = async (_req, res) => sendSuccess(res, { message: "Invoice settings fetched successfully", data: await settings.getSettings() });
export const update = async (req, res) => sendSuccess(res, { message: "Invoice settings saved", data: await settings.updateSettings(req.body, req.user) });
