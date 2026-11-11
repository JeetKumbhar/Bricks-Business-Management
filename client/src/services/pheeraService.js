// The Pheera service the TruckTripContext talks to: a thin wrapper over services/pheeraApi.js. No sample data, no fallback:
// a failed call throws the ApiError. (services/truckTripService.js is the old in-memory mock; the app no longer uses it.)
import { assignPheeraCustomer, correctPheera, createPheeraBatch, fetchAllPheeras, releasePheera, voidPheera } from "./pheeraApi";

export const pheeraService = {
  /** Every Pheera, voided ones included (the screens hide them; numbering gaps need them). Read page by page and checked against the server total. */
  listPheeras: ({ signal } = {}) => fetchAllPheeras({ includeVoided: true }, { signal }),
  /** input: { submissionId, businessDate, truckId, rows } -> { records, duplicate, summary, submissionId }. All rows are saved together or not at all. */
  savePheeraBatch: ({ submissionId, businessDate, truckId, rows }) => createPheeraBatch({ truckId, businessDate, submissionId, rows }),
  /** Void with a reason (soft delete). */
  deletePheera: (id, reason) => voidPheera(id, reason),
  /** Correct material / destination / quantity / remarks (reason required). Returns the record as the server now holds it. */
  correctPheera: (id, changes, reason) => correctPheera(id, changes, reason),
  /** Give the Pheera a customer, or change it while it is not in a bill. */
  assignCustomer: (id, customerId, reason) => assignPheeraCustomer(id, customerId, reason),
  /** Release a billed Pheera whose invoice was cancelled, so it can be billed again later. */
  releasePheera: (id, reason) => releasePheera(id, reason),
};
