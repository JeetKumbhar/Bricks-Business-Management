// Pheera (truck trip) data service. The rest of the app only talks to THIS file, never to the mock data directly.
//
// Mock phase: an in-memory store with an async API shape (every call returns a Promise), so swapping in real HTTP
// calls later means changing only the bodies below. API wiring points are marked [API].
//   [API] GET    /truck-trips                -> listPheeras
//   [API] POST   /truck-trips/batch          -> savePheeraBatch   (the server assigns Pheera numbers)
//   [API] DELETE /truck-trips/:id            -> deletePheera      (soft delete, reason required)
import { initialPheeras } from "../mock/truckTrips";
import { validateBatch } from "../validators/pheeraValidator";
import { buildPheeraRecords, markPheeraDeleted } from "../features/trucks/pheeraOps";

export function createTruckTripService(seed = []) {
  let records = [...seed];
  const savedBatches = new Map(); // batchId -> saved records (protects against a double submit)

  return {
    /** All records, including soft-deleted ones (the selectors hide those). */
    async listPheeras() {
      return [...records];
    },

    /**
     * Save one batch (one truck + one date, one or more rows). All rows are saved together or not at all.
     * The Pheera numbers are assigned HERE from the current records, never trusted from the screen.
     * Sending the same batchId twice returns the first result instead of saving again.
     * input: { batchId, businessDate, truckId, drafts, trucks, today }
     * -> { records, duplicate }
     */
    async savePheeraBatch({ batchId, businessDate, truckId, drafts, trucks, today, now = new Date() }) {
      if (savedBatches.has(batchId)) return { records: savedBatches.get(batchId), duplicate: true };

      const check = validateBatch({ businessDate, truckId, today, trucks, drafts });
      if (!check.valid) throw new Error(check.message ?? "The Pheera entry is not valid");

      const truck = trucks.find((t) => t.id === truckId);
      const created = buildPheeraRecords({ existing: records, truck, businessDate, values: check.values, batchId, now });
      records = [...records, ...created];
      savedBatches.set(batchId, created);
      return { records: created, duplicate: false };
    },

    /** Soft delete with a mandatory reason. The number stays used. */
    async deletePheera(id, reason, now = new Date()) {
      const current = records.find((r) => r.id === id);
      if (!current || current.isDeleted) throw new Error("This Pheera no longer exists");
      const updated = markPheeraDeleted(current, reason, now);
      records = records.map((r) => (r.id === id ? updated : r));
      return updated;
    },
  };
}

/** The app-wide instance (in memory; resets when the page is reloaded, like the other mock stores). */
export const truckTripService = createTruckTripService(initialPheeras);
