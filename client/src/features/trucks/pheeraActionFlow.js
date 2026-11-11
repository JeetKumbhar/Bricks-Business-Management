// Runs one Pheera action (correct / assign customer / release) and turns the result into something a dialog can show.
// Definite refusals (400/409/403/404) mean NOTHING was changed: the dialog stays open with the server's own message and the
// person's input kept. A lost connection / timeout / 5xx is NOT "not changed": the store has already re-read the list, so the
// dialog closes and the person is told to check the record before trying again (no blind second request).
import { classifyApiError, ERROR_KIND } from "../../services/apiErrorKinds";

export async function runPheeraAction(run) {
  try {
    return { ok: true, result: await run() };
  } catch (error) {
    // thrown by our own validation (not the server): a plain message, nothing was sent
    if (!(error?.name === "ApiError")) return { ok: false, unsure: false, kind: ERROR_KIND.UNKNOWN, message: error?.message ?? "Something went wrong", fieldErrors: {} };
    const c = classifyApiError(error);
    return { ok: false, unsure: c.kind === ERROR_KIND.CONNECTION, kind: c.kind, message: c.message, fieldErrors: c.fieldErrors };
  }
}
