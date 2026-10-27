// Checks every mock record against its Zod schema and the cross-record rules.
// Runs once in development (see context/LabourContext.jsx) and logs the result to the browser console.
import {
  attendanceRecordSchema,
  labourRecordSchema,
  maapEntrySchema,
  paymentRecordSchema,
  productionEntrySchema,
  rateHistoryEntrySchema,
  seasonSchema,
} from "../validators/labourRecordValidator";
import { LABOUR_TYPE_META } from "../utils/labourTypes";
import { initialAttendance } from "./attendance";
import { initialLabours } from "./labours";
import { initialMaapEntries } from "./maapEntries";
import { initialPayments } from "./payments";
import { initialProductionEntries } from "./production";
import { initialRateHistory } from "./rateHistory";
import { initialSeasons } from "./seasons";

export function validateMocks() {
  const errors = [];

  const check = (schema, items, label) =>
    items.forEach((item, index) => {
      const result = schema.safeParse(item);
      if (!result.success) {
        const detail = result.error.issues.map((i) => `${i.path.join(".") || "(record)"}: ${i.message}`).join("; ");
        errors.push(`${label}[${index}] ${item.id ?? ""} - ${detail}`);
      }
    });

  check(labourRecordSchema, initialLabours, "labours");
  check(attendanceRecordSchema, initialAttendance, "attendance");
  check(paymentRecordSchema, initialPayments, "payments");
  check(rateHistoryEntrySchema, initialRateHistory, "rateHistory");
  check(maapEntrySchema, initialMaapEntries, "maapEntries");
  check(productionEntrySchema, initialProductionEntries, "production");
  check(seasonSchema, initialSeasons, "seasons");

  // ---- cross-record rules ----
  const typeOf = Object.fromEntries(initialLabours.map((l) => [l.id, l.labourType]));
  const unique = (values, label) => {
    const seen = new Set();
    values.forEach((v) => {
      if (seen.has(v)) errors.push(`${label}: duplicate ${v}`);
      seen.add(v);
    });
  };
  unique(initialLabours.map((l) => l.id), "labour id");
  unique(initialLabours.map((l) => l.mobile), "labour mobile");
  unique(initialPayments.map((p) => p.id), "payment id");
  unique(initialAttendance.map((a) => a.id), "attendance id");
  unique(initialMaapEntries.map((e) => e.id), "maap entry id");
  unique(initialProductionEntries.map((e) => e.id), "production entry id");

  initialAttendance.forEach((a) => {
    if (typeOf[a.labourId] !== "BIGARI") errors.push(`attendance ${a.id}: ${a.labourId} is not a BIGARI`);
  });
  initialMaapEntries.forEach((e) => {
    if (typeOf[e.labourId] !== "MAAPVALI") errors.push(`maap entry ${e.id}: ${e.labourId} is not a MAAPVALI`);
  });
  initialProductionEntries.forEach((e) => {
    if (typeOf[e.teamId] !== "PATLAVALE") errors.push(`production ${e.id}: ${e.teamId} is not a PATLAVALE team`);
  });
  initialPayments.forEach((p) => {
    const expected = typeOf[p.recipientId] === "PATLAVALE" ? "TEAM" : "WORKER";
    if (!typeOf[p.recipientId]) errors.push(`payment ${p.id}: unknown recipient ${p.recipientId}`);
    else if (p.recipientType !== expected) errors.push(`payment ${p.id}: recipientType should be ${expected}`);
  });
  initialRateHistory.forEach((r) => {
    const type = typeOf[r.labourId];
    if (!type) errors.push(`rate ${r.id}: unknown labour ${r.labourId}`);
    else if (r.rateType !== LABOUR_TYPE_META[type].rateType) errors.push(`rate ${r.id}: rateType does not match ${type}`);
  });

  // One entry per worker / team per date (saving a day again updates it; it never adds a second record).
  const oneADay = (entries, ownerKey, label) => {
    const seen = new Set();
    entries.forEach((e) => {
      const key = `${e[ownerKey]}|${e.date}`;
      if (seen.has(key)) errors.push(`${label} ${e.id}: two entries on one date for ${e[ownerKey]}`);
      seen.add(key);
    });
  };
  oneADay(initialMaapEntries, "labourId", "maap entry");
  oneADay(initialProductionEntries, "teamId", "production");

  const counts = {
    BIGARI: initialLabours.filter((l) => l.labourType === "BIGARI").length,
    MAAPVALI: initialLabours.filter((l) => l.labourType === "MAAPVALI").length,
    PATLAVALE: initialLabours.filter((l) => l.labourType === "PATLAVALE").length,
    attendance: initialAttendance.length,
    payments: initialPayments.length,
    maapEntries: initialMaapEntries.length,
    productionEntries: initialProductionEntries.length,
  };

  return { ok: errors.length === 0, errors, counts };
}
