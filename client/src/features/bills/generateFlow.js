// One "Create draft bill from Pheeras" attempt, from request to a result the screen can show. No React. `deps` = { generate, readPheeras }
// (services/billApi.generateBillFromPheeras and a function that reads the customer's Pheeras again), so it is tested without a server.
//   created      the server made the draft (or answered "already made" for the same requestId): { bill, trips, duplicate }
//   refused      the server said no (400/409/403/404): NOTHING was created. { message, problems[] } (server's own words)
//   confirmed    unsure outcome, and the re-read shows the draft exists: { billId }
//   not_applied  unsure outcome, and the re-read shows nothing happened: the SAME attempt (same requestId) may be sent again
//   unconfirmed  unsure outcome that could not be settled: nothing may be sent again until it is
import { ApiError } from "../../services/api";
import { classifyApiError, ERROR_KIND } from "../../services/apiErrorKinds";
import { reconcileGenerate } from "./pheeraBilling";

const problemsOf = (error) => (error instanceof ApiError ? error.errors.map((e) => e?.message).filter(Boolean) : []);

export async function runGenerate({ attempt, customerId }, deps) {
  try {
    const result = await deps.generate({ tripIds: attempt.tripIds, requestId: attempt.requestId });
    return { kind: "created", ...result };
  } catch (error) {
    if (!(error instanceof ApiError)) return { kind: "refused", message: error?.message ?? "Something went wrong", problems: [] };
    const c = classifyApiError(error);
    if (c.kind !== ERROR_KIND.CONNECTION) return { kind: "refused", message: c.message, problems: problemsOf(error) };
    // unsure: read the Pheeras again instead of guessing
    try {
      const pheeras = await deps.readPheeras(customerId);
      const settled = reconcileGenerate(attempt.tripIds, pheeras);
      return { kind: settled.status, billId: settled.billId, why: settled.why, message: c.message };
    } catch {
      return { kind: "unconfirmed", why: "The Pheera list could not be read again to check.", message: c.message };
    }
  }
}
