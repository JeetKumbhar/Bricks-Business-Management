import { Router } from "express";
import { ROLES } from "../constants/roles.js";
import { correct, getOne, list, remove, saveDay, teamHistory } from "../controllers/productionEntry.controller.js";
import requireRole from "../middlewares/role.middleware.js";
import validate from "../middlewares/validation.middleware.js";
import asyncHandler from "../utils/asyncHandler.js";
import { correctionSchema, dateParamsSchema, deleteSchema, idParamsSchema, listQuerySchema, saveDaySchema, teamHistoryQuerySchema, teamParamsSchema } from "../validators/productionEntry.validators.js";

// Mounted after requireAuth in app.js. Reading is open to any signed-in user; changing is Owner only until the owner
// confirms the other roles. DELETE is a soft delete with a mandatory reason: nothing is erased.
const ownerOnly = requireRole(ROLES.OWNER);

/** /api/production-entries */
const router = Router();
router.get("/", validate(listQuerySchema, "query"), asyncHandler(list));
router.put("/day/:date", ownerOnly, validate(dateParamsSchema, "params"), validate(saveDaySchema), asyncHandler(saveDay));
router.get("/:id", validate(idParamsSchema, "params"), asyncHandler(getOne));
router.patch("/:id", ownerOnly, validate(idParamsSchema, "params"), validate(correctionSchema), asyncHandler(correct));
router.delete("/:id", ownerOnly, validate(idParamsSchema, "params"), validate(deleteSchema), asyncHandler(remove));
export default router;

/** /api/labours/:id/production-entries: one team's history (mounted before /api/labours in app.js). */
export const labourProductionRouter = Router({ mergeParams: true });
labourProductionRouter.get("/", validate(teamParamsSchema, "params"), validate(teamHistoryQuerySchema, "query"), asyncHandler(teamHistory));
