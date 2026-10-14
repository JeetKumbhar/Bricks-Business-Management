import { useMemo } from "react";
import useLabours from "../labours/useLabours";

/**
 * Payment history for every recipient (workers of all types and Patlavale teams), joined with the recipient's
 * name and labour type, plus the add / correct / delete actions.
 * `labours` is every labour record, so the recipient picker can search individuals and teams together.
 * Backed by LabourProvider (in-memory mock) for now.
 */
export default function usePayments() {
  const { allLabours, allPayments, deletedPayments, addPayment, updatePayment, deletePayment } = useLabours();

  const { history, deleted } = useMemo(() => {
    const byId = Object.fromEntries(allLabours.map((l) => [l.id, l]));
    const join = (p) => ({
      ...p,
      labourName: byId[p.labourId]?.name ?? p.labourId,
      labourType: byId[p.labourId]?.labourType,
    });
    return { history: allPayments.map(join), deleted: deletedPayments.map(join) };
  }, [allLabours, allPayments, deletedPayments]);

  return { history, deleted, labours: allLabours, addPayment, updatePayment, deletePayment };
}
