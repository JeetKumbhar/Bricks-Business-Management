import { Router } from "express";
import { allTrucks, daily, destination, material, range, truck } from "../controllers/truckReport.controller.js";
import validate from "../middlewares/validation.middleware.js";
import asyncHandler from "../utils/asyncHandler.js";
import { dailyQuerySchema, rangeQuerySchema, reportQuerySchema, truckParamsSchema } from "../validators/truckReport.validators.js";

// Truck reports for the main Reports page. Read-only for every signed-in user; there is no write route.
/** /api/truck-reports */
const router = Router();
router.get("/truck/:truckId", validate(truckParamsSchema, "params"), validate(reportQuerySchema, "query"), asyncHandler(truck));
router.get("/daily", validate(dailyQuerySchema, "query"), asyncHandler(daily));
router.get("/range", validate(rangeQuerySchema, "query"), asyncHandler(range));
router.get("/material", validate(reportQuerySchema, "query"), asyncHandler(material));
router.get("/destination", validate(reportQuerySchema, "query"), asyncHandler(destination));
router.get("/all-trucks", validate(reportQuerySchema, "query"), asyncHandler(allTrucks));
export default router;
