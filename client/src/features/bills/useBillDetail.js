import { useCallback, useEffect, useState } from "react";
import { ApiError, getErrorMessage } from "../../services/api";
import { useBills } from "../../context/BillContext";

/** One bill read from the server (with items, seller snapshot and the server's totals). `id` null = nothing to load (a new bill). */
export default function useBillDetail(id) {
  const { loadBill } = useBills();
  const [state, setState] = useState({ bill: null, loading: Boolean(id), error: null, notFound: false });
  const [key, setKey] = useState(0);

  useEffect(() => {
    if (!id) return undefined;
    const controller = new AbortController();
    loadBill(id, { signal: controller.signal })
      .then((bill) => !controller.signal.aborted && setState({ bill, loading: false, error: null, notFound: false }))
      .catch((error) => {
        if (controller.signal.aborted) return;
        const notFound = error instanceof ApiError && error.status === 404;
        setState({ bill: null, loading: false, error: notFound ? null : getErrorMessage(error, "Could not load the bill"), notFound });
      });
    return () => controller.abort();
  }, [id, loadBill, key]);

  const reload = useCallback(() => {
    setState((s) => ({ ...s, loading: true, error: null }));
    setKey((k) => k + 1);
  }, []);
  const setBill = useCallback((bill) => setState({ bill, loading: false, error: null, notFound: false }), []);
  return { ...state, reload, setBill };
}
