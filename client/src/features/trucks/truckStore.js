import { getErrorMessage } from "../../services/api";
import { createStore } from "./createStore";
import { normalizeTruckNumber, truckNumberKey } from "./truckOps";

/**
 * The truck data logic (no React). Every truck comes from the server through `api` (services/truckApi.js); there is no sample-data fallback.
 * state: { trucks, status: loading | ready | error, loadError, histories: { [truckId]: { status, items, error } } }
 * Every change is sent first and the list is updated from the server's answer. The server has no maintenance records, no truck cost,
 * no delete and no pagination, so none of those exist here.
 */
export function createTruckStore(api) {
  const store = createStore({ trucks: [], status: "loading", loadError: "", histories: {} });
  let controller = null;

  const dropHistory = (id) =>
    store.setState((s) => {
      const { [id]: _removed, ...rest } = s.histories;
      return { histories: rest };
    });
  const upsert = (truck) => store.setState((s) => ({ trucks: s.trucks.some((t) => t.id === truck.id) ? s.trucks.map((t) => (t.id === truck.id ? truck : t)) : [...s.trucks, truck] }));

  /** Reads the whole list. Resolves { ok, trucks } and never throws (a failure sets status "error"). */
  const load = async () => {
    controller?.abort();
    const mine = new AbortController();
    controller = mine;
    if (store.getState().status !== "ready") store.setState({ status: "loading" }); // a re-read of a shown list does not blank it
    try {
      const { items } = await api.listTrucks({}, { signal: mine.signal });
      if (mine.signal.aborted) return { ok: false, trucks: [] };
      store.setState({ trucks: items, status: "ready", loadError: "" });
      return { ok: true, trucks: items };
    } catch (error) {
      if (mine.signal.aborted) return { ok: false, trucks: [] };
      store.setState({ status: "error", loadError: getErrorMessage(error, "Could not load the trucks.") });
      return { ok: false, trucks: [] };
    }
  };

  return {
    ...store,
    load,
    stop: () => controller?.abort(),
    isTruckNumberTaken: (number, excludeId) => store.getState().trucks.some((t) => t.id !== excludeId && truckNumberKey(t.truckNumber) === truckNumberKey(number)),
    /** values: { truckNumber, nickname, model, capacity, driverId } -> the saved truck (server-made id). Rejects with the server's error. */
    async addTruck(values) {
      const truck = await api.createTruck({ ...values, truckNumber: normalizeTruckNumber(values.truckNumber) });
      upsert(truck);
      dropHistory(truck.id);
      return truck;
    },
    /** Sends only the fields that changed. Nothing changed -> rejects before any request. */
    async updateTruck(id, changes) {
      const current = store.getState().trucks.find((t) => t.id === id);
      if (!current) throw new Error("This truck no longer exists");
      const next = changes.truckNumber === undefined ? changes : { ...changes, truckNumber: normalizeTruckNumber(changes.truckNumber) };
      const truck = await api.updateTruck(current, next);
      upsert(truck);
      dropHistory(id);
      return truck;
    },
    /** input: { status, reason, note, description } -> { truck, historyEntry }. (A cost is not sent: the server cannot store it.) */
    async changeStatus(id, input) {
      const result = await api.changeTruckStatus(id, input);
      upsert(result.truck);
      dropHistory(id);
      return result;
    },
    async loadHistory(truckId) {
      store.setState((s) => ({ histories: { ...s.histories, [truckId]: { status: "loading", items: [], error: "" } } }));
      try {
        const items = await api.getTruckHistory(truckId);
        store.setState((s) => ({ histories: { ...s.histories, [truckId]: { status: "ready", items, error: "" } } }));
      } catch (error) {
        store.setState((s) => ({ histories: { ...s.histories, [truckId]: { status: "error", items: [], error: getErrorMessage(error, "Could not load the history.") } } }));
      }
    },
  };
}
