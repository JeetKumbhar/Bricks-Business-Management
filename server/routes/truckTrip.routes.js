import { Router } from "express";
import { ROLES } from "../constants/roles.js";
import { assign, batch, correct, create, day, getOne, list, options, release, voidOne } from "../controllers/truckTrip.controller.js";
import requireRole from "../middlewares/role.middleware.js";
import validate from "../middlewares/validation.middleware.js";
import asyncHandler from "../utils/asyncHandler.js";
import { assignCustomerSchema, batchSchema, correctionSchema, createTripSchema, dayQuerySchema, idParamsSchema, listQuerySchema, releaseSchema, voidSchema } from "../validators/truckTrip.validators.js";

// Mounted after requireAuth in app.js. Reading is open to any signed-in user; changing is Owner only until the owner confirms the
// other roles. DELETE (and POST /:id/void, the same thing) is a soft delete with a mandatory reason: nothing is erased.
const ownerOnly = requireRole(ROLES.OWNER);

/** /api/truck-trips */
const router = Router();
router.get("/", validate(listQuerySchema, "query"), asyncHandler(list));
router.get("/day", validate(dayQuerySchema, "query"), asyncHandler(day));
router.get("/options", asyncHandler(options));
router.post("/", ownerOnly, validate(createTripSchema), asyncHandler(create));
router.post("/batch", ownerOnly, validate(batchSchema), asyncHandler(batch));
router.get("/:id", validate(idParamsSchema, "params"), asyncHandler(getOne));
router.patch("/:id", ownerOnly, validate(idParamsSchema, "params"), validate(correctionSchema), asyncHandler(correct));
router.delete("/:id", ownerOnly, validate(idParamsSchema, "params"), validate(voidSchema), asyncHandler(voidOne));
router.patch("/:id/customer", ownerOnly, validate(idParamsSchema, "params"), validate(assignCustomerSchema), asyncHandler(assign));
router.post("/:id/release", ownerOnly, validate(idParamsSchema, "params"), validate(releaseSchema), asyncHandler(release));
router.post("/:id/void", ownerOnly, validate(idParamsSchema, "params"), validate(voidSchema), asyncHandler(voidOne));
export default router;
