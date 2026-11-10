import { getErrorMessage } from "../../services/api";
import * as customerApi from "../../services/customerApi";
import { createStore } from "../trucks/createStore";

/**
 * The customer data logic (no React). Every customer comes from the server through `api` (services/customerApi.js); no sample-data
 * fallback. state: { items (active AND archived, as the server sent them), status: loading | ready | error, loadError }.
 * A change is sent first and the list is updated from the server's answer, so the screen shows what is saved.
 * The server decides everything (name uniqueness, what "Internal / No Bill" may do, whether archiving is allowed).
 */
export function createCustomerStore(api = customerApi) {
  const store = createStore({ items: [], status: "loading", loadError: "" });
  let controller = null;
  const upsert = (c) => store.setState((s) => ({ items: s.items.some((x) => x.id === c.id) ? s.items.map((x) => (x.id === c.id ? c : x)) : [...s.items, c] }));

  /** Reads the whole list (archived included). Resolves { ok, items } and never throws. A re-read of a shown list does not blank it. */
  const load = async () => {
    controller?.abort();
    const mine = new AbortController();
    controller = mine;
    if (store.getState().status !== "ready") store.setState({ status: "loading" });
    try {
      const items = await api.fetchAllCustomers({ includeArchived: true }, { signal: mine.signal });
      if (mine.signal.aborted) return { ok: false, items: [] };
      store.setState({ items, status: "ready", loadError: "" });
      return { ok: true, items };
    } catch (error) {
      if (mine.signal.aborted) return { ok: false, items: [] };
      store.setState({ status: "error", loadError: getErrorMessage(error, "Could not load the customers.") });
      return { ok: false, items: [] };
    }
  };

  return {
    ...store,
    load,
    stop: () => controller?.abort(),
    /** values: { name, address, gstin, stateName, stateCode, contact } -> the saved customer. Rejects with the server's error. */
    async create(values) {
      const c = await api.createCustomer(values);
      upsert(c);
      return c;
    },
    /** `current` MUST be the customer as it was when the form was opened: its revision is sent, so a change made by someone else in between is refused (409), never overwritten. */
    async update(current, changes) {
      const c = await api.updateCustomer(current, changes);
      upsert(c);
      return c;
    },
    async archive(id, reason) {
      const c = await api.archiveCustomer(id, reason);
      upsert(c);
      return c;
    },
    async restore(id, reason) {
      const c = await api.restoreCustomer(id, reason);
      upsert(c);
      return c;
    },
    /** Makes sure "Internal / No Bill" exists. A success only means it is available (the server answers the same whether it was just made or already there). */
    async enableInternal() {
      const c = await api.enableInternalCustomer();
      upsert(c);
      return c;
    },
  };
}
