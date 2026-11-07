import { z } from "zod";
import { filterFields, rangeCheck, truckParamsSchema } from "./truckTrip.validators.js";

// Report filters: the same ones as the Pheera list (truck, registration, material, materialName, destination, dates).
// Reports never include voided records, so there is no includeVoided here.
const { date: _date, ...rangeFilters } = filterFields;

export { truckParamsSchema };
/** Truck history, material-wise, destination-wise, all-trucks: an optional from / to range plus the other filters. */
export const reportQuerySchema = z.strictObject(rangeFilters).superRefine(rangeCheck);
/** Daily report: one date is required. */
export const dailyQuerySchema = z.strictObject({ ...rangeFilters, date: filterFields.date.unwrap() }).superRefine((q, ctx) => {
  if (q.from || q.to) ctx.addIssue({ code: "custom", path: ["date"], message: "Use date, not from / to, for the daily report" });
});
/** Date-range report: from and to are both required. */
export const rangeQuerySchema = z
  .strictObject(rangeFilters)
  .superRefine(rangeCheck)
  .superRefine((q, ctx) => {
    if (!q.from) ctx.addIssue({ code: "custom", path: ["from"], message: "from is required" });
    if (!q.to) ctx.addIssue({ code: "custom", path: ["to"], message: "to is required" });
  });
