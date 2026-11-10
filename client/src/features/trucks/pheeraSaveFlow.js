// The "save a Pheera entry" rules, with no React and no network of its own (so they can be tested).
//
//  - ONE submissionId per entry. It is replaced only after the server CONFIRMED a save (never because an answer was lost).
//  - Only one request at a time: a second submit while one is running is ignored ("busy").
//  - A definite refusal from the server (400 / 409) means NOTHING was saved: the entry stays editable, the server's messages are
//    returned per row, and the same submissionId may be used again.
//  - An unknown outcome (connection lost, timeout, unreadable answer, 5xx) means the server MAY have saved it: the exact payload and
//    submissionId are kept as `pending`. submit() then re-sends THAT payload with THAT id (the server answers "already saved" if it
//    had been saved), never the edited rows and never a new id. Only discard() (the user's explicit choice) drops it.
//  - An error thrown before anything was sent (for example a quantity that is not a number) is "invalid": nothing was saved.
import { ApiError } from "../../services/api";
import { classifyApiError, groupRowErrors } from "../../services/apiErrorKinds";
import { newSubmissionId } from "../../services/pheeraMapper";
import { createStore } from "./createStore";

const NO_ERRORS = { rows: {}, general: {} };

export function createSaveFlow({ save, newId = newSubmissionId }) {
  const store = createStore({ saving: false, pending: null, serverErrors: NO_ERRORS, submissionId: newId() });

  /** payload: { truckId, businessDate, rows }. -> { status: "saved" | "refused" | "unknown" | "invalid" | "busy", ... } */
  const submit = async (payload) => {
    const before = store.getState();
    if (before.saving) return { status: "busy" };
    const { pending } = before;
    const use = pending ?? { submissionId: before.submissionId, payload };
    store.setState({ saving: true, ...(pending ? {} : { serverErrors: NO_ERRORS }) });
    try {
      const result = await save({ submissionId: use.submissionId, ...use.payload });
      store.setState({ saving: false, pending: null, serverErrors: NO_ERRORS, submissionId: newId() });
      return { status: "saved", result };
    } catch (error) {
      if (!(error instanceof ApiError)) {
        store.setState({ saving: false });
        return { status: "invalid", error };
      }
      const info = classifyApiError(error);
      if (info.nothingSaved) {
        const serverErrors = groupRowErrors(error);
        store.setState({ saving: false, pending: null, serverErrors });
        return { status: "refused", info, serverErrors };
      }
      store.setState({ saving: false, pending: { submissionId: use.submissionId, payload: use.payload, message: info.message } });
      return { status: "unknown", info };
    }
  };

  return {
    ...store,
    submit,
    /** The user chose to drop an entry whose outcome is unknown. Only then is a new submissionId made. */
    discard: () => store.setState({ pending: null, serverErrors: NO_ERRORS, submissionId: newId() }),
    clearServerErrors: () => store.setState({ serverErrors: NO_ERRORS }),
  };
}
