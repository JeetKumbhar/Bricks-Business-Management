import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { billService } from "../services/billService";
import { toBillRequest, toCancelRequest, toFinalizeRequest, toSettingsRequest } from "../features/bills/billContract";
import { validateBillInput } from "../validators/billValidator";
import { todayBusinessDate } from "../utils/businessDate";

const BillContext = createContext(null);

/**
 * Bills and invoice settings. Everything goes through services/billService.js (in-memory in this phase).
 * Separate from every other module: nothing here touches labour, attendance, payments or trucks.
 * The requests sent to the service have exactly the shape of the backend API (see features/bills/billContract.js).
 */
export function BillProvider({ children, service = billService }) {
  const [bills, setBills] = useState([]);
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  useEffect(() => {
    let alive = true;
    Promise.all([service.listBills(), service.getSettings()])
      .then(([list, s]) => {
        if (!alive) return;
        setBills(list);
        setSettings(s);
      })
      .catch((error) => alive && setLoadError(error.message ?? "Could not load bills"))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [service]);

  const refresh = useCallback(async () => setBills(await service.listBills()), [service]);

  /** input: { id?, billDate, customer, items (typed rows), taxMode, notes, revision? } */
  const saveDraft = useCallback(async ({ id = null, revision, ...input }) => {
    const check = validateBillInput({ ...input, allowedRates: settings?.allowedTaxRates ?? [] });
    if (!check.valid) throw new Error("The bill is not valid. Fix the highlighted fields and try again");
    const bill = await service.saveDraft(id, toBillRequest(check.value, revision));
    await refresh();
    return bill;
  }, [service, refresh, settings]);

  const finalizeBill = useCallback(async (id, { revision } = {}) => {
    const bill = await service.finalizeBill(id, toFinalizeRequest(revision), { today: todayBusinessDate() });
    await refresh();
    return bill;
  }, [service, refresh]);

  const cancelBill = useCallback(async (id, reason) => {
    const bill = await service.cancelBill(id, toCancelRequest(reason));
    await refresh();
    return bill;
  }, [service, refresh]);

  const discardDraft = useCallback(async (id) => {
    await service.discardDraft(id);
    await refresh();
  }, [service, refresh]);

  const saveSettings = useCallback(async (next) => {
    const saved = await service.saveSettings(toSettingsRequest(next));
    setSettings(saved);
    return saved;
  }, [service]);

  const value = useMemo(
    () => ({ bills, settings, loading, loadError, saveDraft, finalizeBill, cancelBill, discardDraft, saveSettings }),
    [bills, settings, loading, loadError, saveDraft, finalizeBill, cancelBill, discardDraft, saveSettings]
  );
  return <BillContext.Provider value={value}>{children}</BillContext.Provider>;
}

export function useBills() {
  const context = useContext(BillContext);
  if (!context) throw new Error("useBills must be used inside <BillProvider>");
  return context;
}
