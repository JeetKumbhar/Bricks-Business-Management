import * as production from "../services/productionEntry.service.js";
import * as seasons from "../services/season.service.js";
import { sendSuccess } from "../utils/apiResponse.js";

export const list = async (_req, res) => sendSuccess(res, { message: "Seasons fetched successfully", data: await seasons.listSeasons() });
export const getOne = async (req, res) => sendSuccess(res, { message: "Season fetched successfully", data: await seasons.getSeason(req.params.id) });
export const create = async (req, res) => sendSuccess(res, { statusCode: 201, message: "Season created successfully", data: await seasons.createSeason(req.body, req.user) });
export const update = async (req, res) => sendSuccess(res, { message: "Season updated successfully", data: await seasons.updateSeason(req.params.id, req.body, req.user) });
export const seasonProduction = async (req, res) => sendSuccess(res, { message: "Season production fetched successfully", data: await production.getSeasonProduction(req.params.id) });
