import { useCallback, useEffect, useState } from "react";
import { getErrorMessage } from "../../services/api";
import { getSalary } from "../../services/paymentApi";
import useLabours from "../labours/useLabours";

/**
 * Salary for a date range, calculated by the server. Same shape the Salary screen already used: { rows, summary }.
 * Refetches when the range changes and after anything that can change a figure (attendance, work, production, payments, rates).
 * status: "loading" | "ready" | "error". Never falls back to figures worked out in the browser.
 */
export default function useServerSalary(start, end) {
  const { dataVersion } = useLabours();
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState({ status: "loading", rows: [], summary: null, error: "" });

  useEffect(() => {
    const controller = new AbortController();
    setState((prev) => ({ ...prev, status: "loading" }));
    getSalary({ from: start, to: end }, { signal: controller.signal })
      .then((data) => {
        if (!controller.signal.aborted) setState({ status: "ready", rows: data.items, summary: data.summary, error: "" });
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        setState({ status: "error", rows: [], summary: null, error: getErrorMessage(err, "Could not load the salary figures.") });
      });
    return () => controller.abort();
  }, [start, end, dataVersion, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { ...state, retry };
}
