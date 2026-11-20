import { Router } from "express";
import { ROLES } from "../constants/roles.js";
import { create, getOne, list, seasonProduction, closeSeason, getSettlement, settlementPreview, update } from "../controllers/season.controller.js";
import requireRole from "../middlewares/role.middleware.js";
import validate from "../middlewares/validation.middleware.js";
import asyncHandler from "../utils/asyncHandler.js";
import { closeSeasonSchema, createSeasonSchema, idParamsSchema, settlementPreviewQuerySchema, updateSeasonSchema } from "../validators/season.validators.js";

// Reading is open to any signed-in user; creating, changing, closing and reopening are Owner only. There is no DELETE.
const ownerOnly = requireRole(ROLES.OWNER);

/** /api/seasons */
const router = Router();
router.get("/", asyncHandler(list));
router.post("/", ownerOnly, validate(createSeasonSchema), asyncHandler(create));
// Read-only closing preview (S1): computes every worker's season statement from the existing ledger and writes nothing. Owner only.
router.get("/:id/settlement-preview", ownerOnly, validate(idParamsSchema, "params"), validate(settlementPreviewQuerySchema, "query"), asyncHandler(settlementPreview));
// The ONLY way to close a season (S2): one transaction that saves a permanent statement for every worker. It records no worker payment.
router.post("/:id/close", ownerOnly, validate(idParamsSchema, "params"), validate(closeSeasonSchema), asyncHandler(closeSeason));
router.get("/:id/settlement", ownerOnly, validate(idParamsSchema, "params"), asyncHandler(getSettlement));
router.get("/:id/production", validate(idParamsSchema, "params"), asyncHandler(seasonProduction));
router.get("/:id", validate(idParamsSchema, "params"), asyncHandler(getOne));
router.patch("/:id", ownerOnly, validate(idParamsSchema, "params"), validate(updateSeasonSchema), asyncHandler(update));
export default router;
