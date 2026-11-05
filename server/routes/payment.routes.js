import { Router } from "express";
import { ROLES } from "../constants/roles.js";
import { allBalances, correct, create, getOne, labourBalance, list, recipientHistory, voidOne } from "../controllers/payment.controller.js";
import requireRole from "../middlewares/role.middleware.js";
import validate from "../middlewares/validation.middleware.js";
import asyncHandler from "../utils/asyncHandler.js";
import { balancesQuerySchema, correctionSchema, createPaymentSchema, idParamsSchema, labourParamsSchema, listQuerySchema, recipientHistoryQuerySchema, voidSchema } from "../validators/payment.validators.js";

// Mounted after requireAuth in app.js. Reading is open to any signed-in user; changing money records is Owner only until
// the owner confirms the other roles. DELETE voids a payment (soft delete, mandatory reason): nothing is erased.
const ownerOnly = requireRole(ROLES.OWNER);

/** /api/payments */
const router = Router();
router.get("/", validate(listQuerySchema, "query"), asyncHandler(list));
router.post("/", ownerOnly, validate(createPaymentSchema), asyncHandler(create));
router.get("/:id", validate(idParamsSchema, "params"), asyncHandler(getOne));
router.patch("/:id", ownerOnly, validate(idParamsSchema, "params"), validate(correctionSchema), asyncHandler(correct));
router.delete("/:id", ownerOnly, validate(idParamsSchema, "params"), validate(voidSchema), asyncHandler(voidOne));
export default router;

/** /api/labours/:id/payments: one recipient's history (mounted before /api/labours in app.js). */
export const labourPaymentsRouter = Router({ mergeParams: true });
labourPaymentsRouter.get("/", validate(labourParamsSchema, "params"), validate(recipientHistoryQuerySchema, "query"), asyncHandler(recipientHistory));

/** /api/labours/:id/balance */
export const labourBalanceRouter = Router({ mergeParams: true });
labourBalanceRouter.get("/", validate(labourParamsSchema, "params"), asyncHandler(labourBalance));

/** /api/balances */
export const balancesRouter = Router();
balancesRouter.get("/", validate(balancesQuerySchema, "query"), asyncHandler(allBalances));
