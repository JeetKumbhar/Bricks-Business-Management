import { Router } from "express";
import { ROLES } from "../constants/roles.js";
import { archive, create, getOne, internal, list, restore, update } from "../controllers/customer.controller.js";
import requireRole from "../middlewares/role.middleware.js";
import validate from "../middlewares/validation.middleware.js";
import asyncHandler from "../utils/asyncHandler.js";
import { archiveSchema, createCustomerSchema, idParamsSchema, listQuerySchema, restoreSchema, updateCustomerSchema } from "../validators/customer.validators.js";

// Reading is open to any signed-in user; every write is Owner only. There is no hard DELETE: DELETE archives (soft delete with a
// reason) and POST /:id/restore is the explicit way back.
const ownerOnly = requireRole(ROLES.OWNER);
const id = validate(idParamsSchema, "params");

/** /api/customers */
const router = Router();
router.get("/", validate(listQuerySchema, "query"), asyncHandler(list));
router.post("/", ownerOnly, validate(createCustomerSchema), asyncHandler(create));
router.post("/internal", ownerOnly, asyncHandler(internal)); // idempotent: creates the built-in "Internal / No Bill" customer once
router.get("/:id", id, asyncHandler(getOne));
router.patch("/:id", ownerOnly, id, validate(updateCustomerSchema), asyncHandler(update));
router.delete("/:id", ownerOnly, id, validate(archiveSchema), asyncHandler(archive));
router.post("/:id/restore", ownerOnly, id, validate(restoreSchema), asyncHandler(restore));
export default router;
