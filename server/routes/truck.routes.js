import { Router } from "express";
import { ROLES } from "../constants/roles.js";
import { changeStatus, create, getOne, history, list, listStopped, listWorking, update } from "../controllers/truck.controller.js";
import requireRole from "../middlewares/role.middleware.js";
import validate from "../middlewares/validation.middleware.js";
import asyncHandler from "../utils/asyncHandler.js";
import { createTruckSchema, idParamsSchema, listQuerySchema, statusChangeSchema, updateTruckSchema } from "../validators/truck.validators.js";

// Mounted after requireAuth in app.js. Reading is open to any signed-in user; changing is Owner only until the owner confirms the
// other roles. There is deliberately no DELETE: trucks with history are never removed.
const ownerOnly = requireRole(ROLES.OWNER);

/** /api/trucks */
const router = Router();
router.get("/", validate(listQuerySchema, "query"), asyncHandler(list));
router.get("/working", validate(listQuerySchema, "query"), asyncHandler(listWorking));
router.get("/stopped", validate(listQuerySchema, "query"), asyncHandler(listStopped));
router.post("/", ownerOnly, validate(createTruckSchema), asyncHandler(create));
router.get("/:id", validate(idParamsSchema, "params"), asyncHandler(getOne));
router.patch("/:id", ownerOnly, validate(idParamsSchema, "params"), validate(updateTruckSchema), asyncHandler(update));
router.post("/:id/status", ownerOnly, validate(idParamsSchema, "params"), validate(statusChangeSchema), asyncHandler(changeStatus));
router.get("/:id/history", validate(idParamsSchema, "params"), asyncHandler(history));
export default router;
