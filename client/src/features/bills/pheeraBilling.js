// Rules for making a draft bill from Pheeras (pure functions; no React, no network). The SERVER is the authority: it refuses ineligible
// Pheeras and mixed customers itself. These helpers only keep the screen from offering what the server will refuse, and settle an
// UNCERTAIN outcome by reading the server's state again.
import { isLockedRecord, isVoidedRecord } from "../trucks/pheeraLifecycle";

/** A fresh id for ONE generate attempt. The same id is reused when the same request is repeated (the server then answers "already made"). */
export const newRequestId = () => `req-${globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`}`.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64);

/** Eligible for a NEW draft as far as the screen can tell: UNBILLED (never null, never reserved/billed/internal), not voided, has a customer. */
export const isOfferable = (r) => !isVoidedRecord(r) && r.billingStatus === "UNBILLED" && Boolean(r.customerId);

/**
 * Check a selection before anything is sent. selected = ids; offered = the Pheeras on screen (from the server's billable list).
 * -> { ok, problem?, customerId?, rows }
 */
export function checkSelection(selected, offered) {
  if (selected.length === 0) return { ok: false, problem: "Select at least one Pheera", rows: [] };
  const byId = new Map(offered.map((r) => [r.id, r]));
  const rows = selected.map((id) => byId.get(id));
  if (rows.some((r) => !r)) return { ok: false, problem: "Some selected Pheeras are no longer in the list. Reload the list and select again", rows: [] };
  const stale = rows.find((r) => !isOfferable(r));
  if (stale) return { ok: false, problem: `Pheera #${stale.pheeraNumber} of ${stale.truckRegistration} cannot be billed (${isLockedRecord(stale) ? "it is in a bill" : "it is not unbilled"})`, rows };
  const customers = [...new Set(rows.map((r) => r.customerId))];
  if (customers.length > 1) return { ok: false, problem: "Pheeras of different customers cannot be on one bill", rows };
  return { ok: true, customerId: customers[0], rows };
}

/** Totals of a selection, never mixing units: { count, bricks, tonnes }. (Display only; the bill's money comes from the server.) */
export function selectionSummary(rows) {
  const out = { count: rows.length, bricks: 0, tonnes: 0 };
  for (const r of rows) {
    if (r.unit === "bricks") out.bricks += r.quantity;
    else out.tonnes = Math.round((out.tonnes + r.quantity) * 100) / 100;
  }
  return out;
}

/**
 * After an UNCERTAIN generate (lost connection, timeout, 5xx) the Pheeras are read again and compared with what was asked for.
 *   confirmed    every selected Pheera is RESERVED by the same draft  -> { status, billId }
 *   not_applied  every selected Pheera is still UNBILLED               -> safe to send the SAME request again (same requestId)
 *   unconfirmed  anything else (mixed, missing, read failed)           -> do not send again until it is settled
 * pheeras = the freshly read records of the customer (voided included).
 */
export function reconcileGenerate(tripIds, pheeras) {
  const byId = new Map(pheeras.map((r) => [r.id, r]));
  const rows = tripIds.map((id) => byId.get(id));
  if (rows.some((r) => !r)) return { status: "unconfirmed", why: "Some of the selected Pheeras could not be found when the list was read again." };
  const reserved = rows.filter((r) => r.billingStatus === "RESERVED" && r.bill?.id);
  const billIds = [...new Set(reserved.map((r) => r.bill.id))];
  if (reserved.length === rows.length && billIds.length === 1) return { status: "confirmed", billId: billIds[0] };
  if (rows.every((r) => r.billingStatus === "UNBILLED")) return { status: "not_applied" };
  return { status: "unconfirmed", why: "The Pheeras are in different states. Check them in the Pheera list before trying again." };
}

/** After an UNCERTAIN add: the server's bill is read again. confirmed = every id is now on the bill; not_applied = none is. */
export function reconcileAdd(tripIds, bill) {
  const on = new Set(bill.sourceTripIds ?? []);
  const hits = tripIds.filter((id) => on.has(id)).length;
  return hits === tripIds.length ? { status: "confirmed" } : hits === 0 ? { status: "not_applied" } : { status: "unconfirmed", why: "Only some of the Pheeras are on the draft. Reload the bill and check it." };
}

/** After an UNCERTAIN remove: confirmed = the Pheera is no longer on the bill; not_applied = it still is. */
export const reconcileRemove = (tripId, bill) => ((bill.sourceTripIds ?? []).includes(tripId) ? { status: "not_applied" } : { status: "confirmed" });

/** A draft made from Pheeras can have Pheeras added only when it is linked to a saved customer (the server refuses otherwise). */
export const canAddPheeras = (bill) => bill?.status === "DRAFT" && Boolean(bill.customerId);
export const canRemovePheera = (bill) => bill?.status === "DRAFT";
