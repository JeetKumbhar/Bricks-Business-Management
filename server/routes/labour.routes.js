import { Router } from "express";
import { ROLES } from "../constants/roles.js";
import { addRate, create, getOne, list, listRates, summary, update } from "../controllers/labour.controller.js";
import requireRole from "../middlewares/role.middleware.js";
import validate from "../middlewares/validation.middleware.js";
import asyncHandler from "../utils/asyncHandler.js";
import { createLabourSchema, listQuerySchema, rateChangeSchema, updateLabourSchema } from "../validators/labour.validators.js";

// /api/labours. Mounted after requireAuth in app.js, so every route needs a login.
// Reading is open to any signed-in user; changing anything is Owner only until the owner confirms other roles.
// There is deliberately no DELETE: a worker who leaves is set INACTIVE and keeps all history.
const router = Router();
const ownerOnly = requireRole(ROLES.OWNER);

router.get("/", validate(listQuerySchema, "query"), asyncHandler(list));
router.get("/summary", asyncHandler(summary)); // before "/:id"
router.post("/", ownerOnly, validate(createLabourSchema), asyncHandler(create));

router.get("/:id", asyncHandler(getOne));
router.patch("/:id", ownerOnly, validate(updateLabourSchema), asyncHandler(update));

router.get("/:id/rates", asyncHandler(listRates));
router.post("/:id/rates", ownerOnly, validate(rateChangeSchema), asyncHandler(addRate));

export default router;
