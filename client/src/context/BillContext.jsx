import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { getErrorMessage } from "../services/api";
import { runBillChange } from "../features/bills/billChange";
import { billApiService } from "../services/billApiService";
import { toBillRequest, toCancelRequest, toFinalizeRequest, toSettingsRequest } from "../features/bills/billContract";
import { validateBillInput } from "../validators/billValidator";
import { todayBusinessDate } from "../utils/businessDate";

const BillContext = createContext(null);

/**
 * Bills and invoice settings, read from and saved to the server through services/billApiService.js (no sample data, nothing kept in
 * the browser). `bills` are LIST rows (customer name, number, status and the server's totals; no items): a bill's full details come
 * from `loadBill(id)`. The settings are owner only on the server, so a failed settings read is reported separately (`settingsError`)
 * and never hides the bills. After every successful change the list is read again; after an UNSURE outcome (lost connection,
 * timeout, 5xx) it is read again too, so the screen shows what the server really holds.
 * The requests have exactly the shape of the backend API (features/bills/billContract.js).
 */
export function BillProvider({ children, service = billApiService }) {
  const [bills, setBills] = useState([]);
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [settingsError, setSettingsError] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    Promise.allSettled([service.listBills({ signal }), service.getSettings({ signal })]).then(([list, s]) => {
      if (signal.aborted) return;
      if (list.status === "fulfilled") {
        setBills(list.value);
        setLoadError(null);
      } else setLoadError(getErrorMessage(list.reason, "Could not load bills"));
      if (s.status === "fulfilled") {
        setSettings(s.value);
        setSettingsError(null);
      } else setSettingsError(getErrorMessage(s.reason, "Could not load the invoice settings"));
      setLoading(false);
    });
    return () => controller.abort();
  }, [service, reloadKey]);

  const reload = useCallback(() => {
    setLoading(true);
    setReloadKey((k) => k + 1);
  }, []);

  /** Quiet re-read of the list. A failed re-read does not turn a confirmed change into a failure. */
  const refresh = useCallback(async () => {
    try {
      setBills(await service.listBills());
      setLoadError(null);
    } catch (error) {
      setLoadError(getErrorMessage(error, "Saved, but the list could not be refreshed. Reload the page."));
    }
  }, [service]);

  const change = useCallback((run) => runBillChange(run, refresh), [refresh]);

  /** One bill with its items, seller snapshot and the server's totals. */
  const loadBill = useCallback((id, options) => service.getBill(id, options), [service]);

  /** input: { id?, billDate, customer, items (typed rows), taxMode, notes, revision? } */
  const saveDraft = useCallback(async ({ id = null, revision, ...input }) => {
    const check = validateBillInput({ ...input, allowedRates: settings?.allowedTaxRates ?? [] });
    if (!check.valid) throw new Error("The bill is not valid. Fix the highlighted fields and try again");
    return change(() => service.saveDraft(id, toBillRequest(check.value, revision)));
  }, [service, change, settings]);

  const finalizeBill = useCallback((id, { revision } = {}) => change(() => service.finalizeBill(id, toFinalizeRequest(revision), { today: todayBusinessDate() })), [service, change]);
  const cancelBill = useCallback((id, reason) => change(() => service.cancelBill(id, toCancelRequest(reason))), [service, change]);
  const discardDraft = useCallback((id) => change(() => service.discardDraft(id)), [service, change]);

  const saveSettings = useCallback(async (next) => {
    const saved = await service.saveSettings(toSettingsRequest(next));
    setSettings(saved); // the values the SERVER confirmed
    setSettingsError(null);
    return saved;
  }, [service]);

  const value = useMemo(
    () => ({ bills, settings, loading, loadError, settingsError, reload, loadBill, saveDraft, finalizeBill, cancelBill, discardDraft, saveSettings }),
    [bills, settings, loading, loadError, settingsError, reload, loadBill, saveDraft, finalizeBill, cancelBill, discardDraft, saveSettings]
  );
  return <BillContext.Provider value={value}>{children}</BillContext.Provider>;
}

export function useBills() {
  const context = useContext(BillContext);
  if (!context) throw new Error("useBills must be used inside <BillProvider>");
  return context;
}
