import { createContext, useCallback, useMemo, useState } from "react";
import { buildLabourStats, enrichAttendance, groupBy, sortRatesAsc } from "../features/labours/labourStats";
import { initialAttendance } from "../mock/attendance";
import { initialLabours } from "../mock/labours";
import { initialPayments } from "../mock/payments";
import { initialRateHistory } from "../mock/rateHistory";

export const LabourContext = createContext(null);

// TODO (auth phase): use the logged-in user.
const CURRENT_USER = "Ramesh Patel";

const idNumber = (id) => Number(id.replace(/\D/g, ""));
const formatId = (n) => `L-${String(n).padStart(3, "0")}`;

/**
 * Shared in-memory store (mock phase) so the list page and the profile page see the same data.
 * Later: replace with API calls (services/api.js) - keep the same functions.
 * Totals are never stored; they are calculated from attendance, payments and rate history.
 */
export function LabourProvider({ children }) {
  const [baseLabours, setBaseLabours] = useState(initialLabours);
  const [attendance] = useState(initialAttendance); // setters arrive with the Attendance / Payments phases
  const [payments] = useState(initialPayments);
  const [rateChanges, setRateChanges] = useState(initialRateHistory);

  const { attendanceBy, paymentsBy, ratesBy } = useMemo(() => {
    const ratesGrouped = groupBy(rateChanges, "labourId");
    return {
      attendanceBy: groupBy(attendance, "labourId"),
      paymentsBy: groupBy(payments, "labourId"),
      ratesBy: Object.fromEntries(Object.entries(ratesGrouped).map(([id, list]) => [id, sortRatesAsc(list)])),
    };
  }, [attendance, payments, rateChanges]);

  const labours = useMemo(
    () => baseLabours.map((l) => buildLabourStats(l, attendanceBy[l.id], paymentsBy[l.id], ratesBy[l.id])),
    [baseLabours, attendanceBy, paymentsBy, ratesBy]
  );

  // IDs are never reused: highest existing number + 1.
  const nextLabourId = useMemo(
    () => formatId(Math.max(0, ...baseLabours.map((l) => idNumber(l.id))) + 1),
    [baseLabours]
  );

  const addLabour = useCallback(
    (values) => {
      const labour = {
        id: nextLabourId,
        name: values.name,
        mobile: values.mobile,
        village: values.village,
        status: values.status,
        joiningDate: values.joiningDate,
        dailyRate: values.dailyRate,
        photo: null,
      };
      setBaseLabours((prev) => [...prev, labour]);
      setRateChanges((prev) => [
        ...prev,
        {
          id: `rate-${labour.id}-0`,
          labourId: labour.id,
          rate: values.dailyRate,
          effectiveFrom: values.joiningDate,
          reason: "Initial rate",
          changedBy: CURRENT_USER,
          createdAt: values.joiningDate,
        },
      ]);
      return labour;
    },
    [nextLabourId]
  );

  const updateLabour = useCallback((id, changes) => {
    setBaseLabours((prev) => prev.map((l) => (l.id === id ? { ...l, ...changes } : l)));
  }, []);

  const isMobileTaken = useCallback(
    (mobile, excludeId) => baseLabours.some((l) => l.mobile === mobile && l.id !== excludeId),
    [baseLabours]
  );

  const changeRate = useCallback((labourId, { rate, effectiveFrom, reason }) => {
    setRateChanges((prev) => [
      ...prev,
      {
        id: `rate-${labourId}-${Date.now()}`,
        labourId,
        rate,
        effectiveFrom,
        reason,
        changedBy: CURRENT_USER,
        createdAt: new Date().toISOString(),
      },
    ]);
  }, []);

  const getLabour = useCallback((id) => labours.find((l) => l.id === id), [labours]);

  /** Newest first, each record has units / rate / earned. */
  const getAttendance = useCallback(
    (id) =>
      enrichAttendance(attendanceBy[id] ?? [], ratesBy[id] ?? []).sort((a, b) => b.date.localeCompare(a.date)),
    [attendanceBy, ratesBy]
  );

  /** Newest first, deleted payments excluded. */
  const getPayments = useCallback(
    (id) => (paymentsBy[id] ?? []).filter((p) => !p.isDeleted).sort((a, b) => b.date.localeCompare(a.date)),
    [paymentsBy]
  );

  /** Newest first. */
  const getRateHistory = useCallback((id) => [...(ratesBy[id] ?? [])].reverse(), [ratesBy]);

  const value = useMemo(
    () => ({
      labours,
      nextLabourId,
      addLabour,
      updateLabour,
      isMobileTaken,
      changeRate,
      getLabour,
      getAttendance,
      getPayments,
      getRateHistory,
    }),
    [labours, nextLabourId, addLabour, updateLabour, isMobileTaken, changeRate, getLabour, getAttendance, getPayments, getRateHistory]
  );

  return <LabourContext.Provider value={value}>{children}</LabourContext.Provider>;
}
