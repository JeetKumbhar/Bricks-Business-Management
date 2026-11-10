import { useEffect, useMemo, useSyncExternalStore } from "react";
import { createCustomerStore } from "../features/customers/customerStore";
import * as customerApi from "../services/customerApi";
import { CustomerContext } from "./customerContextValue";

/**
 * The customer list, shared by the Customers screen and the Pheera entry dropdown, so a customer added (or archived) in one place
 * is seen in the other at once. The logic is in features/customers/customerStore.js (server data only); this connects it to React.
 * `api` can be replaced in tests.
 */
export function CustomerProvider({ children, api = customerApi }) {
  const store = useMemo(() => createCustomerStore(api), [api]);
  const state = useSyncExternalStore(store.subscribe, store.getState);

  useEffect(() => {
    store.load();
    return store.stop;
  }, [store]);

  const value = useMemo(() => ({ ...state, reload: store.load, create: store.create, update: store.update, archive: store.archive, restore: store.restore, enableInternal: store.enableInternal, getItems: () => store.getState().items }), [state, store]);
  return <CustomerContext.Provider value={value}>{children}</CustomerContext.Provider>;
}

