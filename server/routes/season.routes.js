import { Router } from "express";
import { ROLES } from "../constants/roles.js";
import { create, getOne, list, seasonProduction, update } from "../controllers/season.controller.js";
import requireRole from "../middlewares/role.middleware.js";
import validate from "../middlewares/validation.middleware.js";
import asyncHandler from "../utils/asyncHandler.js";
import { createSeasonSchema, idParamsSchema, updateSeasonSchema } from "../validators/season.validators.js";

// Reading is open to any signed-in user; creating, changing, closing and reopening are Owner only. There is no DELETE.
const ownerOnly = requireRole(ROLES.OWNER);

/** /api/seasons */
const router = Router();
router.get("/", asyncHandler(list));
router.post("/", ownerOnly, validate(createSeasonSchema), asyncHandler(create));
router.get("/:id/production", validate(idParamsSchema, "params"), asyncHandler(seasonProduction));
router.get("/:id", validate(idParamsSchema, "params"), asyncHandler(getOne));
router.patch("/:id", ownerOnly, validate(idParamsSchema, "params"), validate(updateSeasonSchema), asyncHandler(update));
export default router;
