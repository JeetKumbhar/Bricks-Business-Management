import { Router } from "express";
import { ROLES } from "../constants/roles.js";
import { addTrips, billTrips, cancel, correct, create, discard, finalize, getOne, history, list, pdf, removeTrip, fromTrips, update } from "../controllers/bill.controller.js";
import requireRole from "../middlewares/role.middleware.js";
import validate from "../middlewares/validation.middleware.js";
import asyncHandler from "../utils/asyncHandler.js";
import { addTripsSchema, cancelSchema, fromTripsSchema, tripParamsSchema, createBillSchema, discardSchema, finalizeSchema, idParamsSchema, listQuerySchema, pdfQuerySchema, updateBillSchema } from "../validators/bill.validators.js";

// Reading and printing are open to any signed-in user; every write is Owner only. There is no hard DELETE: a draft is discarded
// (kept, hidden), a finalized bill is cancelled (kept, visible).
const ownerOnly = requireRole(ROLES.OWNER);
const id = validate(idParamsSchema, "params");

/** /api/bills */
const router = Router();
router.get("/", validate(listQuerySchema, "query"), asyncHandler(list));
router.post("/", ownerOnly, validate(createBillSchema), asyncHandler(create));
router.post("/from-trips", ownerOnly, validate(fromTripsSchema), asyncHandler(fromTrips));
router.get("/:id/trips", id, asyncHandler(billTrips));
router.post("/:id/trips", ownerOnly, id, validate(addTripsSchema), asyncHandler(addTrips));
router.delete("/:id/trips/:tripId", ownerOnly, validate(tripParamsSchema, "params"), asyncHandler(removeTrip));
router.get("/:id/pdf", id, validate(pdfQuerySchema, "query"), asyncHandler(pdf));
router.get("/:id/history", id, asyncHandler(history));
router.post("/:id/finalize", ownerOnly, id, validate(finalizeSchema), asyncHandler(finalize));
router.post("/:id/cancel", ownerOnly, id, validate(cancelSchema), asyncHandler(cancel));
router.post("/:id/correct", ownerOnly, id, asyncHandler(correct));
router.post("/:id/discard", ownerOnly, id, validate(discardSchema), asyncHandler(discard));
router.get("/:id", id, asyncHandler(getOne));
router.patch("/:id", ownerOnly, id, validate(updateBillSchema), asyncHandler(update));
export default router;
