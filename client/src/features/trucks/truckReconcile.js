// What to do when a truck save has an UNCERTAIN outcome (connection lost, timeout, unreadable answer, server 5xx): the server may or may not
// have saved it. No React and no network of its own, so it can be tested. The rules:
//  - a definite refusal (400 / 409 / 403 ...) or an error thrown before anything was sent is "refused": nothing was saved, nothing to reconcile;
//  - an uncertain outcome is NEVER reported as a definite failure: the truck list is read again from the server and compared with what was asked for;
//      confirmed    the server shows the requested change           -> the screen can close and confirm it
//      not_applied  the server shows the truck as it was before     -> safe to save again
//      unconfirmed  anything else, or the list could not be read    -> stay marked unconfirmed; do NOT save again until it is settled
//  - status changes are compared by the status AND its `statusSince` time, so a retry after "not_applied" cannot create a second history entry
//    for a change that already landed, and a change that landed is never repeated.
import { ApiError } from "../../services/api";
import { truckNumberKey } from "./truckOps";

const text = (v) => (v == null ? "" : String(v).trim());
const same = (field, a, b) => {
  if (field === "capacity") return text(a) === "" || text(b) === "" ? text(a) === text(b) : Number(a) === Number(b);
  if (field === "truckNumber") return truckNumberKey(a) === truckNumberKey(b);
  return text(a) === text(b); // "" and null are the same (nickname, model, driverId)
};
const FIELDS = ["truckNumber", "nickname", "model", "capacity", "driverId"];

/** op = { kind: "create" | "update" | "status", before, intended }.
 *  create: before = { ids: [ids of the trucks that existed] }, intended = the new truck's values.
 *  update: before = the truck as it was, intended = the changes asked for.
 *  status: before = the truck as it was, intended = { status, reason }.
 *  trucks = the list freshly read from the server. -> { status: "confirmed" | "not_applied" | "unconfirmed", truck?, why? } */
export function reconcile(op, trucks) {
  if (op.kind === "create") {
    const found = trucks.find((t) => truckNumberKey(t.truckNumber) === truckNumberKey(op.intended.truckNumber));
    if (!found) return { status: "not_applied" };
    if (op.before.ids.includes(found.id)) return { status: "unconfirmed", why: "A truck with this number already existed before the save." };
    return { status: "confirmed", truck: found };
  }

  const now = trucks.find((t) => t.id === op.before.id);
  if (!now) return { status: "unconfirmed", why: "The truck is no longer in the list." };

  if (op.kind === "status") {
    const { status, reason } = op.intended;
    const moved = now.status !== op.before.status || now.statusSince !== op.before.statusSince;
    if (!moved) return { status: "not_applied", truck: now };
    if (now.status === status && (status !== "STOPPED" || same("reason", now.stopReason, reason))) return { status: "confirmed", truck: now };
    return { status: "unconfirmed", truck: now, why: "The truck's status is different from both the old and the requested one (someone else may have changed it)." };
  }

  // update: compare only the fields that were really being changed
  const changed = FIELDS.filter((f) => op.intended[f] !== undefined && !same(f, op.intended[f], op.before[f]));
  if (changed.length === 0) return { status: "unconfirmed", truck: now, why: "There was nothing to compare." };
  if (changed.every((f) => same(f, now[f], op.intended[f]))) return { status: "confirmed", truck: now };
  if (changed.every((f) => same(f, now[f], op.before[f]))) return { status: "not_applied", truck: now };
  return { status: "unconfirmed", truck: now, why: "The truck shows a mix of the old and the new values." };
}

/** Runs `action`. -> { status: "done", value } | { status: "refused", error } | { status: "confirmed" | "not_applied" | "unconfirmed", ... }.
 *  `reload` re-reads the list from the server and resolves { ok, trucks } (it must not throw). */
export async function performTruckOperation({ op, action, reload }) {
  try {
    return { status: "done", value: await action() };
  } catch (error) {
    if (!(error instanceof ApiError) || !error.isConnectionProblem) return { status: "refused", error };
    return { ...(await recheck({ op, reload })), cause: error };
  }
}

/** Reads the list again and reconciles. Also used by the "Check again" button. */
export async function recheck({ op, reload }) {
  const fresh = await reload();
  if (!fresh?.ok) return { status: "unconfirmed", why: "The truck list could not be read from the server." };
  return reconcile(op, fresh.trucks);
}
