import { getErrorMessage } from "../../services/api";
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
    async deletePheera(id, reason) {
      const result = await service.deletePheera(id, reason);
      await refresh();
      return result;
    },
  };
}
