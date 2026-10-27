import { createContext, useCallback, useMemo, useState } from "react";
import { buildWorkerStats, enrichAttendance, groupBy, sortRatesAsc } from "../features/labours/labourStats";
import { initialAttendance } from "../mock/attendance";
import { initialLabours } from "../mock/labours";
import { initialMaapEntries } from "../mock/maapEntries";
import { CURRENT_SEASON_ID } from "../mock/seasons";
import { initialPayments } from "../mock/payments";
import { initialProductionEntries } from "../mock/production";
import { initialRateHistory } from "../mock/rateHistory";
import { validateMocks } from "../mock/validateMocks";
import {
  applyProductionCorrection,
  applyProductionDelete,
  upsertProductionDay,
} from "../features/production/productionEntryOps";
import {
  applyMaapCorrection,
  applyMaapDelete,
  upsertMaapDay,
} from "../features/work/maapvali/maapEntryOps";
import { LABOUR_TYPE_META, LABOUR_TYPES } from "../utils/labourTypes";
import { labourRecordSchema, paymentRecordSchema } from "../validators/labourRecordValidator";

export const LabourContext = createContext(null);

// TODO (auth phase): use the logged-in user.
const CURRENT_USER = "Ramesh Patel";

// Development only: check every mock record against its schema once and report in the browser console.
if (import.meta.env.DEV) {
  const result = validateMocks();
  if (result.ok) console.info("[mock data] all records valid", result.counts);
  else console.error(`[mock data] ${result.errors.length} problem(s) found`, result.errors);
}

// The only fields the Edit form may change. Type and rate are never changed here.
const EDITABLE_FIELDS = ["name", "mobile", "village", "joiningDate", "status"];

const idNumber = (id) => Number(id.replace(/\D/g, ""));
const formatId = (n) => `L-${String(n).padStart(3, "0")}`;

/**
 * Shared in-memory store (mock phase) so the list page and the profile page see the same data.
 * Later: replace with API calls (services/api.js) - keep the same functions.
 * Totals are never stored; they are calculated from attendance, payments and rate history.
 */
export function LabourProvider({ children }) {
  const [baseLabours, setBaseLabours] = useState(initialLabours);
  const [attendance, setAttendance] = useState(initialAttendance);
  const [payments, setPayments] = useState(initialPayments);
  const [rateChanges, setRateChanges] = useState(initialRateHistory);
  const [maapEntries, setMaapEntries] = useState(initialMaapEntries);
  const [productionEntries, setProductionEntries] = useState(initialProductionEntries);

  const { attendanceBy, paymentsBy, ratesBy, maapBy, productionBy } = useMemo(() => {
    const ratesGrouped = groupBy(rateChanges, "labourId");
    return {
      attendanceBy: groupBy(attendance, "labourId"),
      // deleted entries (soft delete) are ignored in every total
      maapBy: groupBy(maapEntries.filter((e) => !e.isDeleted), "labourId"),
      productionBy: groupBy(productionEntries.filter((e) => !e.isDeleted), "teamId"),
      paymentsBy: groupBy(payments, "labourId"),
      ratesBy: Object.fromEntries(Object.entries(ratesGrouped).map(([id, list]) => [id, sortRatesAsc(list)])),
    };
  }, [attendance, payments, rateChanges, maapEntries, productionEntries]);

  // Every labour record of every type, with totals calculated from that type's own records.
  const allLabours = useMemo(
    () =>
      baseLabours.map((l) =>
        buildWorkerStats(l, {
          attendance: attendanceBy[l.id],
          maap: maapBy[l.id],
          production: productionBy[l.id],
          payments: paymentsBy[l.id],
          rates: ratesBy[l.id],
        })
      ),
    [baseLabours, attendanceBy, maapBy, productionBy, paymentsBy, ratesBy]
  );

  // Attendance-based screens (Attendance, Payments, Bigari profile) still work with BIGARI workers only.
  // They are updated for the other types in their own phases.
  const labours = useMemo(() => allLabours.filter((l) => l.labourType === LABOUR_TYPES.BIGARI), [allLabours]);

  // IDs are never reused: highest existing number + 1.
  const nextLabourId = useMemo(
    () => formatId(Math.max(0, ...baseLabours.map((l) => idNumber(l.id))) + 1),
    [baseLabours]
  );

  /**
   * values: { labourType, name, mobile, village, status, joiningDate, <the rate field of that type> }
   * Only the rate field of the chosen type is kept, and the record is checked against its schema.
   */
  const addLabour = useCallback(
    (values) => {
      const meta = LABOUR_TYPE_META[values.labourType];
      if (!meta) throw new Error(`Unknown labour type: ${values.labourType}`);
      const rate = values[meta.rateField];

      const labour = labourRecordSchema.parse({
        id: nextLabourId,
        labourType: values.labourType,
        name: values.name,
        mobile: values.mobile,
        village: values.village,
        status: values.status,
        joiningDate: values.joiningDate,
        [meta.rateField]: rate,
        photo: null,
      });

      setBaseLabours((prev) => [...prev, labour]);
      setRateChanges((prev) => [
        ...prev,
        {
          id: `rate-${labour.id}-0`,
          labourId: labour.id,
          rateType: meta.rateType,
          rate,
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

  /** Updates the editable fields only. History (attendance, payments, entries) is never touched. */
  const updateLabour = useCallback((id, changes) => {
    const allowed = Object.fromEntries(Object.entries(changes).filter(([key]) => EDITABLE_FIELDS.includes(key)));
    setBaseLabours((prev) => prev.map((l) => (l.id === id ? { ...l, ...allowed } : l)));
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
        rateType: "DAILY_RATE",
        rate,
        effectiveFrom,
        reason,
        changedBy: CURRENT_USER,
        createdAt: new Date().toISOString(),
      },
    ]);
  }, []);

  /** { [labourId]: status } for one day. */
  const getAttendanceByDate = useCallback(
    (date) => {
      const map = {};
      attendance.forEach((r) => {
        if (r.date === date) map[r.labourId] = r.status;
      });
      return map;
    },
    [attendance]
  );

  /**
   * Save (insert or update) one day's attendance. entries: [{ labourId, status }]
   * One record per labour per date. Attendance can be edited (docs/BUSINESS_RULES.md).
   */
  const saveAttendance = useCallback(
    (date, entries) => {
      // Attendance belongs to BIGARI workers only. Entries for anyone else are dropped, so a Maapvali or a
      // Patlavale team can never get attendance records (or attendance earnings) by mistake.
      const bigariIds = new Set(baseLabours.filter((l) => l.labourType === LABOUR_TYPES.BIGARI).map((l) => l.id));
      const valid = entries.filter((entry) => bigariIds.has(entry.labourId));
      if (import.meta.env.DEV && valid.length !== entries.length) {
        console.warn(`[attendance] ignored ${entries.length - valid.length} entries for non-Bigari labour`);
      }

      setAttendance((prev) => {
        const byKey = new Map(prev.map((r) => [`${r.labourId}|${r.date}`, r]));
        valid.forEach(({ labourId, status }) => {
          const key = `${labourId}|${date}`;
          const existing = byKey.get(key);
          byKey.set(key, { id: existing?.id ?? `att-${labourId}-${date}`, labourId, date, status });
        });
        return [...byKey.values()];
      });
    },
    [baseLabours]
  );

  const byNewest = (a, b) => b.date.localeCompare(a.date) || (b.createdAt ?? "").localeCompare(a.createdAt ?? "");

  /** Every payment that is not deleted, for all labour types (workers and Patlavale teams), newest first. */
  const allPayments = useMemo(() => payments.filter((p) => !p.isDeleted).sort(byNewest), [payments]);

  /** Deleted payments stay on record (soft delete) and are ignored in every balance. */
  const deletedPayments = useMemo(() => payments.filter((p) => p.isDeleted).sort(byNewest), [payments]);

  /**
   * A payment is linked to its recipient: a worker (Bigari or Maapvali) or a Patlavale team.
   * It is a money transaction only: it never touches attendance, maap entries or production.
   */
  const addPayment = useCallback(
    ({ labourId, type, amount, date, note }) => {
      const recipient = baseLabours.find((l) => l.id === labourId);
      if (!recipient) throw new Error(`Unknown payment recipient: ${labourId}`);

      const payment = {
        id: `pay-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        recipientType: recipient.labourType === LABOUR_TYPES.PATLAVALE ? "TEAM" : "WORKER",
        recipientId: labourId,
        labourId, // legacy alias of recipientId (some screens still read it)
        type,
        amount,
        date,
        method: "CASH", // mostly cash (docs/BUSINESS_RULES.md)
        note: note ?? "",
        isDeleted: false,
        createdAt: new Date().toISOString(),
      };
      paymentRecordSchema.parse(payment); // throws if the record is not valid
      setPayments((prev) => [...prev, payment]);
      return payment;
    },
    [baseLabours]
  );

  /**
   * Correct a payment (type / amount / date / note only; the recipient never changes).
   * The old values are kept in `revisions`, so a correction never silently erases what was there before.
   */
  const updatePayment = useCallback((id, changes, reason) => {
    const allowed = Object.fromEntries(
      Object.entries(changes).filter(([key]) => ["type", "amount", "date", "note"].includes(key))
    );
    const now = new Date().toISOString();
    setPayments((prev) =>
      prev.map((p) =>
        p.id === id
          ? {
              ...p,
              ...allowed,
              editedReason: reason,
              updatedAt: now,
              revisions: [
                ...(p.revisions ?? []),
                { changedAt: now, changedBy: CURRENT_USER, reason, before: { type: p.type, amount: p.amount, date: p.date, note: p.note } },
              ],
            }
          : p
      )
    );
  }, []);

  /** Wrong payments are deleted (soft delete: the record stays, balances ignore it). Reason is mandatory. */
  const deletePayment = useCallback((id, reason) => {
    setPayments((prev) =>
      prev.map((p) =>
        p.id === id ? { ...p, isDeleted: true, deletedReason: reason, deletedAt: new Date().toISOString() } : p
      )
    );
  }, []);

  // ---- Maapvali work entries (they never touch payments) ----

  /** Every maap entry that is not deleted, newest first. */
  const allMaapEntries = useMemo(
    () =>
      maapEntries
        .filter((e) => !e.isDeleted)
        .sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt ?? "").localeCompare(a.createdAt ?? "")),
    [maapEntries]
  );

  /** One worker's entries, newest first. */
  const getMaapEntries = useCallback(
    (labourId) => allMaapEntries.filter((e) => e.labourId === labourId),
    [allMaapEntries]
  );

  /** A correction recalculates only that entry (entries are independent: there is no carry-forward). */
  const updateMaapEntry = useCallback((id, changes, reason) => {
    setMaapEntries((prev) => prev.map((e) => (e.id === id ? applyMaapCorrection(e, changes, reason) : e)));
  }, []);

  const deleteMaapEntry = useCallback((id, reason) => {
    setMaapEntries((prev) => prev.map((e) => (e.id === id ? applyMaapDelete(e, reason) : e)));
  }, []);

  /**
   * Save a whole day of Maapvali work in one action. rows: [{ labourId, maaps, note }].
   * One record per worker and date (saving again updates it). Returns the number of records created or corrected.
   */
  const saveMaapDay = useCallback(
    (date, rows, reason) => {
      const byId = Object.fromEntries(baseLabours.map((l) => [l.id, l]));
      const valid = rows
        .filter((r) => byId[r.labourId]?.labourType === "MAAPVALI")
        .map((r) => ({ worker: byId[r.labourId], maaps: r.maaps, note: r.note ?? "" }));
      const { entries, changedIds } = upsertMaapDay({
        allEntries: maapEntries,
        date,
        rows: valid,
        reason,
        seasonId: CURRENT_SEASON_ID,
      });
      setMaapEntries(entries);
      return changedIds.length;
    },
    [baseLabours, maapEntries]
  );

  // ---- Patlavale production ledger (it never touches payments) ----

  /** Every production entry that is not deleted, oldest first. */
  const allProductionEntries = useMemo(
    () =>
      productionEntries
        .filter((e) => !e.isDeleted)
        .sort((a, b) => a.date.localeCompare(b.date) || (a.createdAt ?? "").localeCompare(b.createdAt ?? "")),
    [productionEntries]
  );

  /**
   * Save a whole day of Patlavale production in one action. rows: [{ teamId, maaps, note }].
   * One record per team and date (saving again updates it). Returns the number of records created or corrected.
   */
  const saveProductionDay = useCallback(
    (date, rows, reason) => {
      const byId = Object.fromEntries(baseLabours.map((l) => [l.id, l]));
      const valid = rows
        .filter((r) => byId[r.teamId]?.labourType === "PATLAVALE")
        .map((r) => ({ team: byId[r.teamId], maaps: r.maaps, note: r.note ?? "" }));
      const { entries, changedIds } = upsertProductionDay({
        allEntries: productionEntries,
        date,
        rows: valid,
        reason,
        seasonId: CURRENT_SEASON_ID,
      });
      setProductionEntries(entries);
      return changedIds.length;
    },
    [baseLabours, productionEntries]
  );

  /** A correction recalculates only that entry (entries are independent: there is no carry-forward). */
  const updateProductionEntry = useCallback((id, changes, reason) => {
    setProductionEntries((prev) => prev.map((e) => (e.id === id ? applyProductionCorrection(e, changes, reason) : e)));
  }, []);

  const deleteProductionEntry = useCallback((id, reason) => {
    setProductionEntries((prev) => prev.map((e) => (e.id === id ? applyProductionDelete(e, reason) : e)));
  }, []);

  const getLabour = useCallback((id) => labours.find((l) => l.id === id), [labours]);

  /** Any type (Bigari, Maapvali or Patlavale). getLabour() above returns Bigari only. */
  const getAnyLabour = useCallback((id) => allLabours.find((l) => l.id === id), [allLabours]);

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
      allLabours,
      nextLabourId,
      addLabour,
      updateLabour,
      isMobileTaken,
      changeRate,
      getLabour,
      getAnyLabour,
      getAttendance,
      getAttendanceByDate,
      saveAttendance,
      getPayments,
      allPayments,
      deletedPayments,
      addPayment,
      updatePayment,
      deletePayment,
      allMaapEntries,
      getMaapEntries,
      updateMaapEntry,
      deleteMaapEntry,
      saveMaapDay,
      allProductionEntries,
      saveProductionDay,
      updateProductionEntry,
      deleteProductionEntry,
      getRateHistory,
    }),
    [labours, allLabours, nextLabourId, addLabour, updateLabour, isMobileTaken, changeRate, getLabour, getAnyLabour, getAttendance, getAttendanceByDate, saveAttendance, getPayments, allPayments, deletedPayments, addPayment, updatePayment, deletePayment, allMaapEntries, getMaapEntries, updateMaapEntry, deleteMaapEntry, saveMaapDay, allProductionEntries, saveProductionDay, updateProductionEntry, deleteProductionEntry, getRateHistory]
  );

  return <LabourContext.Provider value={value}>{children}</LabourContext.Provider>;
}
