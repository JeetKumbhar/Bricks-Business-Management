import { useCallback, useEffect, useRef, useState } from "react";
import { addPheerasToBill, getBill, getBillTrips, removePheeraFromBill } from "../../services/billApi";
import { getErrorMessage } from "../../services/api";
import { runAddPheeras, runRemovePheera } from "./draftLineFlow";

const readState = async (id) => {
  const bill = await getBill(id);
  return { bill, trips: await getBillTrips(id) };
};
const deps = { add: addPheerasToBill, remove: removePheeraFromBill, readState };

/**
 * The Pheeras of one bill and the actions on a DRAFT's Pheera lines. Everything shown is what the server last answered.
 * `bill` = the bill as the screen holds it; `onBillChange(bill)` receives the server's bill after every confirmed change.
 * After a refusal or an unsure outcome the draft is read again before anything else is offered (`notice` explains it).
 */
export default function useDraftPheeras(bill, { onBillChange } = {}) {
  const [trips, setTrips] = useState({ rows: [], loading: true, error: null });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null); // { tone: "error" | "warning" | "success", text, problems?, unconfirmed? }
  const busyRef = useRef(false);
  const billId = bill.id;
  const revision = bill.revision;
  const tripCount = bill.sourceTripIds?.length ?? 0;

  useEffect(() => {
    if (tripCount === 0) return undefined;
    const controller = new AbortController();
    getBillTrips(billId, { signal: controller.signal })
      .then((rows) => !controller.signal.aborted && setTrips({ rows, loading: false, error: null }))
      .catch((error) => !controller.signal.aborted && setTrips({ rows: [], loading: false, error: getErrorMessage(error, "Could not load the Pheeras of this bill") }));
    return () => controller.abort();
  }, [billId, revision, tripCount]);

  const rows = tripCount === 0 ? NO_ROWS : trips.rows;

  const apply = useCallback((state) => {
    setTrips({ rows: state.trips, loading: false, error: null });
    onBillChange?.(state.bill);
  }, [onBillChange]);

  const reread = useCallback(async () => {
    try {
      apply(await readState(billId));
      return true;
    } catch (error) {
      setNotice({ tone: "warning", text: `${getErrorMessage(error, "Could not read the draft")} The draft could not be read again: reload the page before changing anything.`, unconfirmed: true });
      return false;
    }
  }, [apply, billId]);

  const run = useCallback(async (start, doneText) => {
    if (busyRef.current) return { kind: "busy" };
    busyRef.current = true;
    setBusy(true);
    setNotice(null);
    try {
      const out = await start();
      if (out.kind === "done" || out.kind === "confirmed") {
        apply(out);
        setNotice({ tone: "success", text: out.kind === "confirmed" ? `${doneText} (confirmed after the connection was restored).` : `${doneText}.` });
      } else if (out.kind === "refused") {
        setNotice({ tone: "error", text: `Nothing was changed. ${out.message}`, problems: out.problems });
        await reread(); // show what the draft really holds now (somebody may have changed it)
      } else if (out.kind === "not_applied") {
        apply(out);
        setNotice({ tone: "warning", text: `${out.message} The server shows nothing was changed. You can try again.` });
      } else {
        setNotice({ tone: "warning", text: `Not confirmed: the connection was lost and the result could not be checked. ${out.why ?? ""}`, unconfirmed: true });
      }
      return out;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [apply, reread]);

  const add = useCallback((tripIds) => run(() => runAddPheeras({ billId, tripIds, revision }, deps), `${tripIds.length} Pheera added`), [run, billId, revision]);
  const remove = useCallback((tripId) => run(() => runRemovePheera({ billId, tripId }, deps), "Pheera removed and released"), [run, billId]);
  const recheck = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    const ok = await reread();
    if (ok) setNotice({ tone: "success", text: "Checked: this is what the server holds now." });
    busyRef.current = false;
    setBusy(false);
  }, [reread]);

  return { rows, loading: tripCount > 0 && trips.loading, loadError: trips.error, busy, notice, locked: busy || Boolean(notice?.unconfirmed), add, remove, recheck, clearNotice: () => setNotice(null) };
}

const NO_ROWS = [];
