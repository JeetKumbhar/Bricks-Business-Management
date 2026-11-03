import { Router } from "express";
import { ROLES } from "../constants/roles.js";
import { getRecord, labourHistory, list, saveDay } from "../controllers/attendance.controller.js";
import requireRole from "../middlewares/role.middleware.js";
import validate from "../middlewares/validation.middleware.js";
import asyncHandler from "../utils/asyncHandler.js";
import { dateParamsSchema, labourHistoryQuerySchema, labourParamsSchema, listQuerySchema, recordParamsSchema, saveDaySchema } from "../validators/attendance.validators.js";

// Mounted after requireAuth in app.js, so every route needs a login. Reading is open to any signed-in user; saving is
// Owner only until the owner confirms the other roles. There is deliberately no DELETE: a record is corrected, never removed.
const ownerOnly = requireRole(ROLES.OWNER);

/** /api/attendance */
const router = Router();
router.get("/", validate(listQuerySchema, "query"), asyncHandler(list));
router.put("/:date", ownerOnly, validate(dateParamsSchema, "params"), validate(saveDaySchema), asyncHandler(saveDay));
router.get("/:date/:labourId", validate(recordParamsSchema, "params"), asyncHandler(getRecord));
export default router;

/** /api/labours/:id/attendance: the profile history of one worker (mounted before /api/labours in app.js). */
export const labourAttendanceRouter = Router({ mergeParams: true });
labourAttendanceRouter.get("/", validate(labourParamsSchema, "params"), validate(labourHistoryQuerySchema, "query"), asyncHandler(labourHistory));
