import { createContext, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildWorkerStats, enrichAttendance, groupBy, sortRatesAsc } from "../features/labours/labourStats";
import { changedCount, removeById, replaceDay, replaceForLabour, upsertById } from "../features/labours/labourDataOps";
import * as labourApi from "../services/labourApi";
import { getErrorMessage } from "../services/api";
import { LABOUR_TYPES } from "../utils/labourTypes";

export const LabourContext = createContext(null);

const EMPTY = Object.freeze({ labours: [], attendance: [], maapEntries: [], productionEntries: [], payments: [], rateChanges: [], seasons: [] });

// Payments are connected to the backend in their own module. Until then the payment history is shown from the server
// (read-only, so every balance is right) and nothing here pretends to save a payment.
const PAYMENTS_NOT_CONNECTED = "Recording or changing payments is not connected to the server yet. Nothing was saved.";
const refusePaymentWrite = () => {
  throw new Error(PAYMENTS_NOT_CONNECTED);
};

/**
 * The shared store for labour, attendance, Maapvali work, Patlavale production, rates, seasons and payments (read-only).
 * Every record comes from the backend (MongoDB). Nothing is invented and there is no sample-data fallback: while loading
 * `status` is "loading", and if the server cannot be read it is "error" (with `reload`), never a half-filled screen.
 * Every change is sent to the server first; the lists are updated from the server's answer, so what is on screen is what
 * is saved. Totals are not stored: they are calculated from these records (features/labours/labourStats.js).
 */
export function LabourProvider({ children }) {
  const [data, setData] = useState(EMPTY);
  const [status, setStatus] = useState("loading"); // loading | ready | error
  const [loadError, setLoadError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [ratesLoaded, setRatesLoaded] = useState(() => new Set()); // labour ids whose rate history is in `rateChanges`
  const dataRef = useRef(data);
  dataRef.current = data;

  useEffect(() => {
    const controller = new AbortController();
    labourApi
      .loadAllData({ signal: controller.signal })
      .then((loaded) => {
        if (controller.signal.aborted) return;
        setData({ ...EMPTY, ...loaded });
        setRatesLoaded(new Set(loaded.labours.filter((l) => l.labourType === LABOUR_TYPES.BIGARI).map((l) => l.id)));
        setLoadError("");
        setStatus("ready");
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        setLoadError(getErrorMessage(err, "Could not load the data."));
        setStatus("error");
      });
    return () => controller.abort();
  }, [attempt]);

  const reload = useCallback(() => {
    setStatus("loading");
    setAttempt((n) => n + 1);
  }, []);

  const patch = useCallback((key, updater) => setData((prev) => ({ ...prev, [key]: updater(prev[key]) })), []);

  const { attendanceBy, paymentsBy, ratesBy, maapBy, productionBy } = useMemo(() => {
    const ratesGrouped = groupBy(data.rateChanges, "labourId");
    return {
      attendanceBy: groupBy(data.attendance, "labourId"),
      // deleted entries (soft delete) are ignored in every total
      maapBy: groupBy(data.maapEntries.filter((e) => !e.isDeleted), "labourId"),
      productionBy: groupBy(data.productionEntries.filter((e) => !e.isDeleted), "teamId"),
      paymentsBy: groupBy(data.payments, "labourId"),
      ratesBy: Object.fromEntries(Object.entries(ratesGrouped).map(([id, list]) => [id, sortRatesAsc(list)])),
    };
  }, [data]);

  // Every labour record of every type, with totals calculated from that type's own records.
  const allLabours = useMemo(
    () =>
      data.labours.map((l) =>
        buildWorkerStats(l, {
          attendance: attendanceBy[l.id],
          maap: maapBy[l.id],
          production: productionBy[l.id],
          payments: paymentsBy[l.id],
          rates: ratesBy[l.id],
        })
      ),
    [data.labours, attendanceBy, maapBy, productionBy, paymentsBy, ratesBy]
  );

  // Attendance-based screens (Attendance, Payments, Bigari profile) work with BIGARI workers only.
  const labours = useMemo(() => allLabours.filter((l) => l.labourType === LABOUR_TYPES.BIGARI), [allLabours]);

  // ---- Labour -------------------------------------------------------------------------------------------------------

  /** values: { labourType, name, mobile, village, status, joiningDate, <the rate field of that type> }. Resolves the saved labour (with its server-made id). */
  const addLabour = useCallback(
    async (values) => {
      const labour = await labourApi.createLabour(values);
      patch("labours", (list) => upsertById(list, labour));
      const rates = await labourApi.getRateHistory(labour.id);
      patch("rateChanges", (list) => replaceForLabour(list, labour.id, rates));
      setRatesLoaded((prev) => new Set(prev).add(labour.id));
      return labour;
    },
    [patch]
  );

  /** Sends only the editable fields that changed (name, mobile, village, joining date, status). History is never touched. */
  const updateLabour = useCallback(
    async (id, changes) => {
      const current = dataRef.current.labours.find((l) => l.id === id);
      if (!current) throw new Error(`Unknown labour: ${id}`);
      const body = labourApi.toUpdateLabourBody(current, changes);
      if (Object.keys(body).length === 0) return current;

      const updated = await labourApi.patchLabour(id, body);
      patch("labours", (list) => upsertById(list, updated));
      // Moving the joining date also moves the first rate row on the server.
      if (body.joiningDate !== undefined) {
        const rates = await labourApi.getRateHistory(id);
        patch("rateChanges", (list) => replaceForLabour(list, id, rates));
      }
      return updated;
    },
    [patch]
  );

  const isMobileTaken = useCallback((mobile, excludeId) => data.labours.some((l) => l.mobile === mobile && l.id !== excludeId), [data.labours]);

  /** Adds a rate-history row on the server (earlier rows and the work priced with them never change). */
  const changeRate = useCallback(
    async (labourId, { rate, effectiveFrom, reason }) => {
      const { rate: row, labour } = await labourApi.postRateChange(labourId, { rate, effectiveFrom, reason });
      patch("labours", (list) => upsertById(list, labour));
      patch("rateChanges", (list) => upsertById(list, row));
    },
    [patch]
  );

  /** Reads one labour's rate history (used when a profile opens, for the types whose history is not loaded up front). */
  const loadRateHistory = useCallback(
    async (id) => {
      const rates = await labourApi.getRateHistory(id);
      patch("rateChanges", (list) => replaceForLabour(list, id, rates));
      setRatesLoaded((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
    },
    [patch]
  );
  const isRateHistoryLoaded = useCallback((id) => ratesLoaded.has(id), [ratesLoaded]);

  // ---- Attendance ---------------------------------------------------------------------------------------------------

  /** { [labourId]: status } for one day. */
  const getAttendanceByDate = useCallback(
    (date) => {
      const map = {};
      data.attendance.forEach((r) => {
        if (r.date === date) map[r.labourId] = r.status;
      });
      return map;
    },
    [data.attendance]
  );

  /**
   * Save (insert or correct) one day's attendance. entries: [{ labourId, status }]. One record per labour per date.
   * Entries for anyone who is not a Bigari worker are dropped here too (the server also refuses them).
   * Resolves the server's counts { created, updated, unchanged }.
   */
  const saveAttendance = useCallback(
    async (date, entries) => {
      const bigariIds = new Set(dataRef.current.labours.filter((l) => l.labourType === LABOUR_TYPES.BIGARI).map((l) => l.id));
      const valid = entries.filter((entry) => bigariIds.has(entry.labourId));
      if (valid.length === 0) return { created: 0, updated: 0, unchanged: 0 };
      const day = await labourApi.saveAttendanceDay(date, valid);
      patch("attendance", (list) => replaceDay(list, date, day.items));
      return day.saved;
    },
    [patch]
  );

  // ---- Payments (read-only until the payments module) -----------------------------------------------------------------

  const byNewest = (a, b) => b.date.localeCompare(a.date) || (b.createdAt ?? "").localeCompare(a.createdAt ?? "");

  /** Every payment that is not deleted, for all labour types (workers and Patlavale teams), newest first. */
  const allPayments = useMemo(() => data.payments.filter((p) => !p.isDeleted).sort(byNewest), [data.payments]);
  /** Deleted payments stay on record (soft delete) and are ignored in every balance. */
  const deletedPayments = useMemo(() => data.payments.filter((p) => p.isDeleted).sort(byNewest), [data.payments]);

  // ---- Maapvali work ------------------------------------------------------------------------------------------------

  /** Every maap entry that is not deleted, newest first. */
  const allMaapEntries = useMemo(
    () => data.maapEntries.filter((e) => !e.isDeleted).sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt ?? "").localeCompare(a.createdAt ?? "")),
    [data.maapEntries]
  );
  const getMaapEntries = useCallback((labourId) => allMaapEntries.filter((e) => e.labourId === labourId), [allMaapEntries]);

  /** Save a whole day of Maapvali work. rows: [{ labourId, maaps, note }]. Resolves how many records were created or corrected. */
  const saveMaapDay = useCallback(
    async (date, rows, reason) => {
      const maapvaliIds = new Set(dataRef.current.labours.filter((l) => l.labourType === LABOUR_TYPES.MAAPVALI).map((l) => l.id));
      const valid = rows.filter((r) => maapvaliIds.has(r.labourId)).map((r) => ({ labourId: r.labourId, maaps: r.maaps, note: r.note ?? "" }));
      if (valid.length === 0) return 0;
      const day = await labourApi.saveMaapDayRequest(date, valid, reason);
      patch("maapEntries", (list) => replaceDay(list, date, day.items));
      return changedCount(day.saved);
    },
    [patch]
  );

  /** A correction recalculates only that entry on the server (the rate snapshot stays; entries are independent). */
  const updateMaapEntry = useCallback(
    async (id, { date, numberOfMaaps, note }, reason) => {
      const entry = await labourApi.correctMaapEntry(id, { date, numberOfMaaps, note, reason });
      patch("maapEntries", (list) => upsertById(list, entry));
    },
    [patch]
  );

  /** Soft delete with a reason: the server keeps the record, every total leaves it out. */
  const deleteMaapEntry = useCallback(
    async (id, reason) => {
      await labourApi.removeMaapEntry(id, reason);
      patch("maapEntries", (list) => removeById(list, id));
    },
    [patch]
  );

  // ---- Patlavale production -----------------------------------------------------------------------------------------

  /** Every production entry that is not deleted, oldest first. */
  const allProductionEntries = useMemo(
    () => data.productionEntries.filter((e) => !e.isDeleted).sort((a, b) => a.date.localeCompare(b.date) || (a.createdAt ?? "").localeCompare(b.createdAt ?? "")),
    [data.productionEntries]
  );

  /** Save a whole day of Patlavale production. rows: [{ teamId, maaps, note }]. Resolves how many records were created or corrected. */
  const saveProductionDay = useCallback(
    async (date, rows, reason) => {
      const teamIds = new Set(dataRef.current.labours.filter((l) => l.labourType === LABOUR_TYPES.PATLAVALE).map((l) => l.id));
      const valid = rows.filter((r) => teamIds.has(r.teamId)).map((r) => ({ teamId: r.teamId, maaps: r.maaps, note: r.note ?? "" }));
      if (valid.length === 0) return 0;
      const day = await labourApi.saveProductionDayRequest(date, valid, reason);
      patch("productionEntries", (list) => replaceDay(list, date, day.items));
      return changedCount(day.saved);
    },
    [patch]
  );

  const updateProductionEntry = useCallback(
    async (id, { date, newMaaps, note }, reason) => {
      const entry = await labourApi.correctProductionEntry(id, { date, newMaaps, note, reason });
      patch("productionEntries", (list) => upsertById(list, entry));
    },
    [patch]
  );

  const deleteProductionEntry = useCallback(
    async (id, reason) => {
      await labourApi.removeProductionEntry(id, reason);
      patch("productionEntries", (list) => removeById(list, id));
    },
    [patch]
  );

  // ---- Seasons (Patlavale production is placed in the season that covers its date) -----------------------------------

  const seasonForDate = useCallback(
    (date) => data.seasons.find((s) => s.startDate <= date && (s.endDate === null || date <= s.endDate)) ?? null,
    [data.seasons]
  );

  const createSeason = useCallback(
    async (input) => {
      const season = await labourApi.createSeasonRequest(input);
      patch("seasons", (list) => upsertById(list, season));
      return season;
    },
    [patch]
  );

  // ---- Lookups ------------------------------------------------------------------------------------------------------

  const getLabour = useCallback((id) => labours.find((l) => l.id === id), [labours]);
  /** Any type (Bigari, Maapvali or Patlavale). getLabour() above returns Bigari only. */
  const getAnyLabour = useCallback((id) => allLabours.find((l) => l.id === id), [allLabours]);
  /** Newest first, each record has units / rate / earned. */
  const getAttendance = useCallback((id) => enrichAttendance(attendanceBy[id] ?? [], ratesBy[id] ?? []).sort((a, b) => b.date.localeCompare(a.date)), [attendanceBy, ratesBy]);
  /** Newest first, deleted payments excluded. */
  const getPayments = useCallback((id) => (paymentsBy[id] ?? []).filter((p) => !p.isDeleted).sort((a, b) => b.date.localeCompare(a.date)), [paymentsBy]);
  /** Newest first. */
  const getRateHistory = useCallback((id) => [...(ratesBy[id] ?? [])].reverse(), [ratesBy]);

  const value = useMemo(
    () => ({
      status,
      loadError,
      reload,
      labours,
      allLabours,
      addLabour,
      updateLabour,
      isMobileTaken,
      changeRate,
      loadRateHistory,
      isRateHistoryLoaded,
      getLabour,
      getAnyLabour,
      getAttendance,
      getAttendanceByDate,
      saveAttendance,
      getPayments,
      allPayments,
      deletedPayments,
      paymentsConnected: false,
      addPayment: refusePaymentWrite,
      updatePayment: refusePaymentWrite,
      deletePayment: refusePaymentWrite,
      allMaapEntries,
      getMaapEntries,
      updateMaapEntry,
      deleteMaapEntry,
      saveMaapDay,
      allProductionEntries,
      saveProductionDay,
      updateProductionEntry,
      deleteProductionEntry,
      seasons: data.seasons,
      seasonForDate,
      createSeason,
      getRateHistory,
    }),
    [status, loadError, reload, labours, allLabours, addLabour, updateLabour, isMobileTaken, changeRate, loadRateHistory, isRateHistoryLoaded, getLabour, getAnyLabour, getAttendance, getAttendanceByDate, saveAttendance, getPayments, allPayments, deletedPayments, allMaapEntries, getMaapEntries, updateMaapEntry, deleteMaapEntry, saveMaapDay, allProductionEntries, saveProductionDay, updateProductionEntry, deleteProductionEntry, data.seasons, seasonForDate, createSeason, getRateHistory]
  );

  return <LabourContext.Provider value={value}>{children}</LabourContext.Provider>;
}
