import { Router } from "express";
import { statement, summary } from "../controllers/salary.controller.js";
import validate from "../middlewares/validation.middleware.js";
import asyncHandler from "../utils/asyncHandler.js";
import { labourParamsSchema, statementQuerySchema, summaryQuerySchema } from "../validators/salary.validators.js";

// Mounted after requireAuth in app.js. Salary is read-only for every signed-in user: there is no write route here,
// because salary is calculated from work and payments, never entered.
const router = Router();
router.get("/", validate(summaryQuerySchema, "query"), asyncHandler(summary));
router.get("/:labourId", validate(labourParamsSchema, "params"), validate(statementQuerySchema, "query"), asyncHandler(statement));
export default router;
