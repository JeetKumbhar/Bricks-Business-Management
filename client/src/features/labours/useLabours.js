import { useCallback, useMemo, useState } from "react";
import { initialLabours } from "../../mock/labours";

const idNumber = (id) => Number(id.replace(/\D/g, ""));
const formatId = (n) => `L-${String(n).padStart(3, "0")}`;

/**
 * Local-state labour store (mock phase).
 * Later: replace the body with API calls (services/api.js) - keep the returned shape.
 * Labour is never deleted; leaving = status INACTIVE (see docs/BUSINESS_RULES.md).
 */
export default function useLabours() {
  const [labours, setLabours] = useState(initialLabours);

  // IDs are never reused: always highest existing number + 1.
  const nextLabourId = useMemo(
    () => formatId(Math.max(0, ...labours.map((l) => idNumber(l.id))) + 1),
    [labours]
  );

  const addLabour = useCallback(
    (values) => {
      const labour = {
        ...values,
        id: nextLabourId,
        photo: null,
        presentDays: 0,
        halfDays: 0,
        totalReceived: 0,
      };
      setLabours((prev) => [...prev, labour]);
      return labour;
    },
    [nextLabourId]
  );

  const updateLabour = useCallback((id, changes) => {
    setLabours((prev) => prev.map((l) => (l.id === id ? { ...l, ...changes } : l)));
  }, []);

  const isMobileTaken = useCallback(
    (mobile, excludeId) => labours.some((l) => l.mobile === mobile && l.id !== excludeId),
    [labours]
  );

  return { labours, nextLabourId, addLabour, updateLabour, isMobileTaken };
}
