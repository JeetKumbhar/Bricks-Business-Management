import { useCallback, useMemo, useState } from "react";
import { useCustomerStore } from "../../context/customerContextValue";
import { splitCustomers } from "./customerChoices";

/**
 * The customers a new Pheera can be given, from the shared customer list (server data, no sample data). `customers` = active normal
 * customers, `internal` = the built-in "Internal / No Bill" customer (or null until it is enabled). Archived customers are never
 * offered and Internal is never mixed into the normal list.
 * `enableInternal()` asks the server to make sure the Internal customer exists; a success only means it is available.
 */
export default function useCustomerChoices() {
  const store = useCustomerStore();
  const [enabling, setEnabling] = useState(false);
  const { customers, internal } = useMemo(() => splitCustomers(store.items), [store.items]);

  const enableInternal = useCallback(async () => {
    setEnabling(true);
    try {
      await store.enableInternal();
    } finally {
      setEnabling(false);
    }
  }, [store]);

  return { status: store.status, error: store.loadError, loading: store.status === "loading", customers, internal, enabling, reload: store.reload, enableInternal };
}
