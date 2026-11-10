import { useCallback, useEffect, useRef, useState } from "react";
import { enableInternalCustomer, fetchAllCustomers } from "../../services/customerApi";
import { splitCustomers } from "./customerChoices";
import { getErrorMessage } from "../../services/api";

/**
 * The customers a new Pheera can be given (read from the server; no sample data). Just enough for the Pheera entry form:
 * this is NOT the Customers screen. `customers` = active normal customers, `internal` = the built-in "Internal / No Bill" customer
 * (or null until it is enabled). Archived customers are never offered, and Internal is never mixed into the normal list.
 * `enableInternal()` asks the server to make sure the Internal customer exists; a success only means it is available (the server
 * answers the same whether it was just created or already there), so the list is read again.
 * `api` can be replaced in tests.
 */
export default function useCustomerChoices(api = { fetchAllCustomers, enableInternalCustomer }) {
  const [state, setState] = useState({ status: "loading", customers: [], internal: null, error: "" });
  const [attempt, setAttempt] = useState(0);
  const [enabling, setEnabling] = useState(false);
  const apiRef = useRef(api);
  useEffect(() => {
    apiRef.current = api;
  });

  useEffect(() => {
    const controller = new AbortController();
    apiRef.current
      .fetchAllCustomers({ includeArchived: false }, { signal: controller.signal })
      .then((all) => {
        if (controller.signal.aborted) return;
        setState({ status: "ready", ...splitCustomers(all), error: "" });
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setState({ status: "error", customers: [], internal: null, error: getErrorMessage(error, "Could not load the customers.") });
      });
    return () => controller.abort();
  }, [attempt]);

  const reload = useCallback(() => {
    setState((s) => ({ ...s, status: "loading" }));
    setAttempt((n) => n + 1);
  }, []);

  const enableInternal = useCallback(async () => {
    setEnabling(true);
    try {
      await apiRef.current.enableInternalCustomer();
      reload();
    } finally {
      setEnabling(false);
    }
  }, [reload]);

  return { ...state, loading: state.status === "loading", enabling, reload, enableInternal };
}
