import { Router } from "express";
import { ROLES } from "../constants/roles.js";
import { get, update } from "../controllers/invoiceSettings.controller.js";
import requireRole from "../middlewares/role.middleware.js";
import validate from "../middlewares/validation.middleware.js";
import asyncHandler from "../utils/asyncHandler.js";
import { updateSettingsSchema } from "../validators/invoiceSettings.validators.js";

// The settings hold the bank details, so reading is Owner only as well as writing.
const ownerOnly = requireRole(ROLES.OWNER);

/** /api/invoice-settings */
const router = Router();
router.get("/", ownerOnly, asyncHandler(get));
router.patch("/", ownerOnly, validate(updateSettingsSchema), asyncHandler(update));
export default router;
