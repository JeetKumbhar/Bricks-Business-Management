// The Bills service the app uses (BillContext default): a thin layer over services/billApi.js with the same method names the
// context calls. Nothing is kept in the browser. (services/billService.js is the old in-memory mock, kept only for its tests.)
import { ApiError } from "./api";
import * as billApi from "./billApi";

/** A refused finalize carries the server's list of problems as `error.problems` ([{ field, message }]) so the screens can mark fields. */
const withProblems = (error) => {
  if (error instanceof ApiError && error.status === 400 && error.errors?.length) error.problems = error.errors;
  return error;
};

export const billApiService = {
  listBills: ({ signal } = {}) => billApi.fetchAllBills({}, { signal }),
  getSettings: ({ signal } = {}) => billApi.getInvoiceSettings({ signal }),
  getBill: (id, { signal } = {}) => billApi.getBill(id, { signal }),
  /** request = toBillRequest(...). id null creates a draft; otherwise the draft is updated (its revision is in the request). */
  saveDraft: (id, request) => (id ? billApi.updateBill(id, request) : billApi.createBill(request)),
  finalizeBill: (id, body) => billApi.finalizeBill(id, body?.revision).catch((e) => { throw withProblems(e); }),
  cancelBill: (id, { reason }) => billApi.cancelBill(id, reason),
  discardDraft: (id) => billApi.discardBill(id),
  saveSettings: (request) => billApi.updateInvoiceSettings(request),
};
