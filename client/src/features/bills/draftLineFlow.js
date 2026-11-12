// Adding or removing ONE batch of Pheera lines on a draft, from request to a result the screen can show. No React. `deps` =
// { add(billId, tripIds, revision), remove(billId, tripId), readState(billId) -> { bill, trips } } so it is tested without a server.
//   done         the server changed the draft and answered with the new bill + Pheeras: { bill, trips }
//   refused      the server said no (400/409/403/404): NOTHING changed. { message, problems[], conflict } - the screen re-reads the draft
//   confirmed    unsure outcome and the re-read shows the change is there: { bill, trips }
//   not_applied  unsure outcome and the re-read shows nothing changed: the action may be offered again
//   unconfirmed  unsure outcome that could not be settled: no further change is offered until it is
// The add endpoint has no idempotency key, so an unsure add is NEVER repeated by itself: the draft is read again first.
import { ApiError } from "../../services/api";
import { classifyApiError, ERROR_KIND } from "../../services/apiErrorKinds";
import { reconcileAdd, reconcileRemove } from "./pheeraBilling";

const problemsOf = (error) => (error instanceof ApiError ? error.errors.map((e) => e?.message).filter(Boolean) : []);

async function attempt(run, settle, deps, billId) {
  try {
    return { kind: "done", ...(await run()) };
  } catch (error) {
    if (!(error instanceof ApiError)) return { kind: "refused", message: error?.message ?? "Something went wrong", problems: [], conflict: false };
    const c = classifyApiError(error);
    if (c.kind !== ERROR_KIND.CONNECTION) return { kind: "refused", message: c.message, problems: problemsOf(error), conflict: c.status === 409 };
    try {
      const state = await deps.readState(billId);
      const settled = settle(state.bill);
      return { kind: settled.status, why: settled.why, message: c.message, ...(settled.status === "unconfirmed" ? {} : state) };
    } catch {
      return { kind: "unconfirmed", why: "The draft could not be read again to check.", message: c.message };
    }
  }
}

export const runAddPheeras = ({ billId, tripIds, revision }, deps) => attempt(() => deps.add(billId, tripIds, revision), (bill) => reconcileAdd(tripIds, bill), deps, billId);
export const runRemovePheera = ({ billId, tripId }, deps) => attempt(() => deps.remove(billId, tripId), (bill) => reconcileRemove(tripId, bill), deps, billId);
