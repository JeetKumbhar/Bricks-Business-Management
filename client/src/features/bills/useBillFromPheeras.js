import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchBillablePheeras, fetchAllPheeras } from "../../services/pheeraApi";
import { generateBillFromPheeras } from "../../services/billApi";
import { getErrorMessage } from "../../services/api";
import { checkSelection, newRequestId, reconcileGenerate, selectionSummary } from "./pheeraBilling";
import { runGenerate } from "./generateFlow";

const NO_ROWS = [];
const deps = { generate: generateBillFromPheeras, readPheeras: (customerId) => fetchAllPheeras({ customerId, includeVoided: true }) };

/**
 * State of the "Bill from Pheeras" screen: the chosen customer, the server's list of billable Pheeras of that customer (UNBILLED only),
 * the selection, and the result of the generate attempt. One attempt = one requestId + the exact set of ids; the same attempt is the
 * only one that may be repeated after an unsure outcome.
 */
export default function useBillFromPheeras({ onCreated } = {}) {
  const [customerId, setCustomerId] = useState("");
  const [list, setList] = useState({ rows: [], loading: false, error: null });
  const [selected, setSelected] = useState([]);
  const [problem, setProblem] = useState(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState(null);
  const [attempt, setAttempt] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!customerId) return undefined;
    const controller = new AbortController();
    fetchBillablePheeras({ customerId }, { signal: controller.signal })
      .then((rows) => !controller.signal.aborted && setList({ rows, loading: false, error: null }))
      .catch((error) => !controller.signal.aborted && setList({ rows: [], loading: false, error: getErrorMessage(error, "Could not load the Pheeras") }));
    return () => controller.abort();
  }, [customerId, reloadKey]);

  const rows = useMemo(() => (customerId ? list.rows : NO_ROWS), [customerId, list.rows]);
  const reload = useCallback(() => {
    setList((l) => ({ ...l, loading: true, error: null }));
    setReloadKey((k) => k + 1);
  }, []);

  // Pheeras that are no longer offered after a re-read drop out of the selection; the others stay selected
  const stillSelected = useMemo(() => selected.filter((id) => rows.some((r) => r.id === id)), [selected, rows]);

  const chooseCustomer = useCallback((id) => {
    setCustomerId(id);
    setSelected([]);
    setProblem(null);
    setOutcome(null);
    setAttempt(null);
    if (id) setList({ rows: [], loading: true, error: null });
  }, []);

  const toggle = useCallback((id) => {
    setProblem(null);
    setAttempt(null); // a changed selection is a NEW request
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  }, []);
  const toggleAll = useCallback((on) => {
    setProblem(null);
    setAttempt(null);
    setSelected(on ? rows.map((r) => r.id) : []);
  }, [rows]);


  const submit = useCallback(async () => {
    if (busy) return;
    const ids = stillSelected;
    const check = checkSelection(ids, rows);
    if (!check.ok) return setProblem(check.problem);
    setProblem(null);
    const current = attempt ?? { requestId: newRequestId(), tripIds: ids };
    setAttempt(current);
    setBusy(true);
    const result = await runGenerate({ attempt: current, customerId: check.customerId }, deps);
    setBusy(false);
    setOutcome(result);
    if (result.kind === "created") onCreated?.(result.bill.id, result);
    else if (result.kind === "confirmed") onCreated?.(result.billId, result);
    else if (result.kind === "refused") reload(); // show what is really available now (a taken Pheera disappears), keep the rest selected
  }, [busy, stillSelected, rows, attempt, onCreated, reload]);

  const chosen = useMemo(() => rows.filter((r) => stillSelected.includes(r.id)), [rows, stillSelected]);
  const summary = useMemo(() => selectionSummary(chosen), [chosen]);
  const locked = busy || outcome?.kind === "unconfirmed";

  /** After an unconfirmed outcome: read the Pheeras again and settle it (nothing is sent). */
  const recheck = useCallback(async () => {
    if (!attempt || busy) return;
    setBusy(true);
    try {
      const settled = reconcileGenerate(attempt.tripIds, await deps.readPheeras(customerId));
      setOutcome({ kind: settled.status, billId: settled.billId, why: settled.why });
      if (settled.status === "confirmed") onCreated?.(settled.billId, settled);
      else if (settled.status === "not_applied") reload();
    } catch {
      setOutcome({ kind: "unconfirmed", why: "The Pheera list could not be read again to check." });
    } finally {
      setBusy(false);
    }
  }, [attempt, busy, customerId, onCreated, reload]);

  return { customerId, chooseCustomer, rows, loading: list.loading, loadError: list.error, reload, selected: stillSelected, toggle, toggleAll, summary, problem, busy, locked, outcome, submit, recheck };
}
