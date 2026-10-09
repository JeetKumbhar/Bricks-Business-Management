import { useMemo } from "react";
import useLabours from "../labours/useLabours";

/**
 * Payment history joined with labour names, plus the add / correct / delete actions.
 * Backed by LabourProvider (in-memory mock) for now.
 */
export default function usePayments() {
  const { labours, allPayments, addPayment, updatePayment, deletePayment } = useLabours();

  const history = useMemo(() => {
    const byId = Object.fromEntries(labours.map((l) => [l.id, l]));
    return allPayments.map((p) => ({
      ...p,
      labourName: byId[p.labourId]?.name ?? p.labourId,
    }));
  }, [labours, allPayments]);

  return { history, labours, addPayment, updatePayment, deletePayment };
}
