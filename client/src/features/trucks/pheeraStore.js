import { ApiError, getErrorMessage } from "../../services/api";
import { createStore } from "./createStore";

/**
 * The Pheera data logic (no React). Every record comes from the server through `service` (services/pheeraService.js); no sample-data
 * fallback. state: { records, loading, loadError }. A failed read leaves the list empty (never half-filled) and sets loadError.
 * After every successful change the full list is read again, so the screen shows exactly what the server holds.
 */
export function createPheeraStore(service) {
  const store = createStore({ records: [], loading: true, loadError: null });
  let controller = null;

  const load = async () => {
    controller?.abort();
    const mine = new AbortController();
    controller = mine;
    store.setState({ loading: true });
    try {
      const list = await service.listPheeras({ signal: mine.signal });
      if (mine.signal.aborted) return;
      store.setState({ records: list, loadError: null, loading: false });
    } catch (error) {
      if (mine.signal.aborted) return;
      store.setState({ loadError: getErrorMessage(error, "Could not load Pheera records"), loading: false });
    }
  };

  /** Quiet re-read after a change. A failed re-read does not turn a CONFIRMED change into a failure. */
  const refresh = async () => {
    try {
      store.setState({ records: await service.listPheeras(), loadError: null });
    } catch (error) {
      store.setState({ loadError: getErrorMessage(error, "Saved, but the list could not be refreshed. Reload the page.") });
    }
  };

  // One change at a time per Pheera: a second click while the first is running is refused here (no duplicate request).
  const busy = new Set();
  const change = async (id, run) => {
    if (busy.has(id)) throw new Error("Another change to this Pheera is still in progress");
    busy.add(id);
    try {
      const result = await run();
      await refresh();
      return result;
    } catch (error) {
      // an unsure outcome (lost connection, timeout, 5xx): re-read so the list shows what the server really holds
      if (error instanceof ApiError && error.isConnectionProblem) await refresh();
      throw error;
    } finally {
      busy.delete(id);
    }
  };

  return {
    ...store,
    load,
    stop: () => controller?.abort(),
    /** input: { submissionId, businessDate, truckId, rows } -> { records, duplicate }. Rejects with the server's error (a lost connection rejects too). */
    async savePheeraBatch(input) {
      const result = await service.savePheeraBatch(input);
      await refresh();
      return result;
    },
    deletePheera: (id, reason) => change(id, () => service.deletePheera(id, reason)),
    correctPheera: (id, changes, reason) => change(id, () => service.correctPheera(id, changes, reason)),
    assignCustomer: (id, customerId, reason) => change(id, () => service.assignCustomer(id, customerId, reason)),
    releasePheera: (id, reason) => change(id, () => service.releasePheera(id, reason)),
  };
}
