import { useRef, useState } from "react";
import { useToast } from "../../components/ui";
import { useCustomerStore } from "../../context/customerContextValue";
import { ApiError, getErrorMessage, getFieldErrors } from "../../services/api";
import { createSingleFlight } from "../trucks/createStore";
import ArchiveCustomerModal from "./ArchiveCustomerModal";
import CustomerFormModal from "./CustomerFormModal";

const messageOf = (error) => (error instanceof ApiError ? getErrorMessage(error) : error?.message || "Something went wrong. Please try again.");
const isConnection = (error) => error instanceof ApiError && error.isConnectionProblem;
const NOT_CONFIRMED = "The connection was lost, so it is not confirmed whether this was saved. The list has been read again: check it before saving again.";

/**
 * The customer actions of the Customers screen: add / edit, archive (reason required), restore, enable Internal / No Bill. `modals` must be
 * rendered once by the page. Every save goes to the server first; "saved" is shown only after the server confirmed; one save runs at a time.
 * The server stays the authority: a refusal (duplicate name, a draft bill holding the customer's Pheera, ...) is shown with the server's own words.
 * A lost connection is "not confirmed", never "failed": the list is read again and saving is blocked until the owner has checked (retrying is
 * also safe on the server: a repeated create is a duplicate-name 409, an edit carries its revision, a repeated archive / restore is a 409).
 */
export default function useCustomerManagement() {
  const toast = useToast();
  const store = useCustomerStore();
  const [form, setForm] = useState(null); // { customer: null } = add, { customer } = edit (the customer AS IT WAS when opened: its revision is sent)
  const [conflict, setConflict] = useState(null);
  const [unconfirmed, setUnconfirmed] = useState(null);
  const [archiveFor, setArchiveFor] = useState(null);
  const [archiveError, setArchiveError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [restoringId, setRestoringId] = useState(null);
  const [enabling, setEnabling] = useState(false);
  const flight = useRef(createSingleFlight());

  const guard = async (fn) => {
    if (flight.current.busy) return undefined;
    setSubmitting(true);
    try {
      return await flight.current.run(fn);
    } finally {
      setSubmitting(false);
    }
  };

  const handleFormSubmit = (values) =>
    guard(async () => {
      if (unconfirmed) return { ok: false, fieldErrors: {} };
      setConflict(null);
      const editing = form.customer;
      try {
        const saved = editing ? await store.update(editing, values) : await store.create(values);
        toast.success(`${saved.name} ${editing ? "updated" : "added"}`);
        setForm(null);
        return { ok: true };
      } catch (error) {
        if (!(error instanceof ApiError)) {
          // thrown before anything was sent (for example "Nothing was changed")
          toast.error(messageOf(error));
          return { ok: false, fieldErrors: {} };
        }
        if (isConnection(error)) {
          setUnconfirmed(NOT_CONFIRMED);
          store.reload();
          toast.error("Not confirmed: the connection was lost. Check the list before saving again.");
          return { ok: false, fieldErrors: {} };
        }
        const fieldErrors = getFieldErrors(error);
        // a 409 with no field (someone else changed it, or it was archived meanwhile): nothing is overwritten; the owner decides
        if (error.status === 409 && Object.keys(fieldErrors).length === 0) {
          setConflict(messageOf(error));
          store.reload();
        }
        toast.error(`Not saved: ${messageOf(error)}`);
        return { ok: false, fieldErrors };
      }
    });

  const handleArchive = (id, reason) =>
    guard(async () => {
      setArchiveError("");
      try {
        const saved = await store.archive(id, reason);
        toast.success(`${saved.name} archived`);
        setArchiveFor(null);
      } catch (error) {
        if (isConnection(error)) {
          store.reload();
          setArchiveError(`${messageOf(error)} Not confirmed: the list was read again, check it before trying again.`);
        } else {
          if (error instanceof ApiError && error.status === 409) store.reload();
          setArchiveError(messageOf(error));
        }
      }
    });

  const restore = (customer) =>
    guard(async () => {
      setRestoringId(customer.id);
      try {
        const saved = await store.restore(customer.id);
        toast.success(`${saved.name} restored`);
      } catch (error) {
        if (isConnection(error)) {
          store.reload();
          toast.error(`${messageOf(error)} Not confirmed: check the list before trying again.`);
        } else {
          if (error instanceof ApiError && error.status === 409) store.reload();
          toast.error(`Not restored: ${messageOf(error)}`);
        }
      } finally {
        setRestoringId(null);
      }
    });

  const enableInternal = async () => {
    if (enabling) return;
    setEnabling(true);
    try {
      await store.enableInternal();
      toast.success("Internal / No Bill is available"); // not "created": the server answers the same when it already existed
    } catch (error) {
      toast.error(`Could not enable Internal / No Bill: ${messageOf(error)}`);
    } finally {
      setEnabling(false);
    }
  };

  const close = () => {
    if (submitting) return;
    setForm(null);
    setConflict(null);
    setUnconfirmed(null);
  };

  const modals = (
    <>
      <CustomerFormModal
        open={Boolean(form)}
        customer={form?.customer ?? null}
        submitting={submitting}
        conflict={conflict}
        unconfirmed={unconfirmed}
        onLoadLatest={() => {
          const latest = store.getItems().find((c) => c.id === form?.customer?.id);
          if (latest) setForm({ customer: latest });
          setConflict(null);
        }}
        onRecheck={async () => {
          const result = await store.reload();
          if (result.ok) setUnconfirmed(null);
        }}
        onClose={close}
        onSubmit={handleFormSubmit}
      />
      <ArchiveCustomerModal customer={archiveFor} submitting={submitting} error={archiveError} onClose={() => !submitting && setArchiveFor(null)} onSubmit={handleArchive} />
    </>
  );

  return {
    items: store.items,
    status: store.status,
    loadError: store.loadError,
    reload: store.reload,
    submitting,
    restoringId,
    enabling,
    openAdd: () => {
      setConflict(null);
      setUnconfirmed(null);
      setForm({ customer: null });
    },
    openEdit: (customer) => {
      setConflict(null);
      setUnconfirmed(null);
      setForm({ customer });
    },
    openArchive: (customer) => {
      setArchiveError("");
      setArchiveFor(customer);
    },
    restore,
    enableInternal,
    modals,
  };
}
