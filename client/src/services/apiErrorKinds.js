// Turns an ApiError into a small, stable description the screens can act on, WITHOUT throwing away the server's own message or
// its field list. Used by the Customer, Truck and Pheera services' callers (Step 2 onwards).
//
//   kind:        what happened (see ERROR_KIND)
//   message:     the server's message, unchanged (a generic text only for a connection problem)
//   fieldErrors: { "trips.0.customerId": "..." } from the server's `errors` array (first message per field)
//   nothingSaved: true ONLY when the server has answered with a refusal. Its writes are all-or-nothing, so a 400/409 means nothing
//                 was written. A lost connection or timeout is NOT "nothing saved": the request may have been stored. Retrying
//                 with the SAME submissionId is then safe (the server answers "already saved" instead of saving twice).
import { ApiError, getFieldErrors } from "./api";

export const ERROR_KIND = Object.freeze({
  CONNECTION: "CONNECTION", // network, timeout, unreadable answer or a 5xx: retry is possible
  UNAUTHENTICATED: "UNAUTHENTICATED", // 401: the session ended (api.js already told the app)
  FORBIDDEN: "FORBIDDEN", // 403: this role may not do it
  NOT_FOUND: "NOT_FOUND", // 404
  VALIDATION: "VALIDATION", // 400: fix the fields and send again
  ARCHIVED_CUSTOMER: "ARCHIVED_CUSTOMER", // 409 whose field errors point at a customer that is archived
  CONFLICT: "CONFLICT", // any other 409 (locked Pheera, already billed, changed by someone else ...)
  UNKNOWN: "UNKNOWN", // not an ApiError at all
});

const isCustomerField = (field) => /(^|\.)customerId$/.test(field);

export function classifyApiError(error) {
  if (!(error instanceof ApiError)) return { kind: ERROR_KIND.UNKNOWN, message: error?.message ?? "Something went wrong. Please try again.", fieldErrors: {}, nothingSaved: false, status: 0 };
  const fieldErrors = getFieldErrors(error);
  const base = { message: error.message, fieldErrors, status: error.status };
  if (error.isConnectionProblem) return { ...base, kind: ERROR_KIND.CONNECTION, nothingSaved: false };
  const refused = { ...base, nothingSaved: true };
  if (error.status === 401) return { ...refused, kind: ERROR_KIND.UNAUTHENTICATED };
  if (error.status === 403) return { ...refused, kind: ERROR_KIND.FORBIDDEN };
  if (error.status === 404) return { ...refused, kind: ERROR_KIND.NOT_FOUND };
  if (error.status === 409) {
    const archived = error.errors.some((e) => isCustomerField(e?.field ?? "") && /archived/i.test(e?.message ?? ""));
    return { ...refused, kind: archived ? ERROR_KIND.ARCHIVED_CUSTOMER : ERROR_KIND.CONFLICT };
  }
  if (error.status === 400) return { ...refused, kind: ERROR_KIND.VALIDATION };
  return { ...refused, kind: ERROR_KIND.UNKNOWN };
}

/**
 * Field errors of a batch, grouped by row: { 0: { customerId: "...", quantity: "..." }, 2: { ... } } from the server's
 * "trips.<row>.<field>" paths. Errors that are not about a row are returned under `general`.
 */
export function groupRowErrors(error, listName = "trips") {
  const rows = {};
  const general = {};
  const pattern = new RegExp(`^${listName}\\.(\\d+)\\.(.+)$`);
  if (error instanceof ApiError) {
    for (const item of error.errors) {
      if (!item?.field) continue;
      const hit = pattern.exec(item.field);
      const target = hit ? (rows[Number(hit[1])] ??= {}) : general;
      const key = hit ? hit[2] : item.field;
      if (!(key in target)) target[key] = item.message;
    }
  }
  return { rows, general };
}
