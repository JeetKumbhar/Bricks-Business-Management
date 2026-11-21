import { Router } from "express";
import { ROLES } from "../constants/roles.js";
import { carryForward, getSettlement, settlementPayment } from "../controllers/settlementPayment.controller.js";
import requireRole from "../middlewares/role.middleware.js";
import validate from "../middlewares/validation.middleware.js";
import asyncHandler from "../utils/asyncHandler.js";
import { idParamsSchema } from "../validators/season.validators.js";
import { carryForwardSchema, settlementPaymentSchema, statementParamsSchema } from "../validators/settlementPayment.validators.js";

// Mounted at /api/seasons BEFORE the season router, so GET /:id/settlement returns the statements plus the derived settlement progress.
// Owner only. Actual final payments and explicit carry-forward decisions against a worker's immutable closing statement (S3).
const ownerOnly = requireRole(ROLES.OWNER);
const router = Router();
router.get("/:id/settlement", ownerOnly, validate(idParamsSchema, "params"), asyncHandler(getSettlement));
router.post("/:id/statements/:statementId/payments", ownerOnly, validate(statementParamsSchema, "params"), validate(settlementPaymentSchema), asyncHandler(settlementPayment));
router.post("/:id/statements/:statementId/carry-forward", ownerOnly, validate(statementParamsSchema, "params"), validate(carryForwardSchema), asyncHandler(carryForward));
export default router;
