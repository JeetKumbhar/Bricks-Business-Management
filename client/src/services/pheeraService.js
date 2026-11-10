// The Pheera service the TruckTripContext talks to: a thin wrapper over services/pheeraApi.js. No sample data, no fallback:
// a failed call throws the ApiError. (services/truckTripService.js is the old in-memory mock; the app no longer uses it.)
import { createPheeraBatch, fetchAllPheeras, voidPheera } from "./pheeraApi";

export const pheeraService = {
  /** Every Pheera, voided ones included (the screens hide them; numbering gaps need them). Read page by page and checked against the server total. */
  listPheeras: ({ signal } = {}) => fetchAllPheeras({ includeVoided: true }, { signal }),
  /** input: { submissionId, businessDate, truckId, rows } -> { records, duplicate, summary, submissionId }. All rows are saved together or not at all. */
  savePheeraBatch: ({ submissionId, businessDate, truckId, rows }) => createPheeraBatch({ truckId, businessDate, submissionId, rows }),
  /** Void with a reason (soft delete). */
  deletePheera: (id, reason) => voidPheera(id, reason),
};
