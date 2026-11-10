import { useRef, useState } from "react";
import { createSingleFlight } from "./createStore";
import { useToast } from "../../components/ui";
import { ApiError, getErrorMessage, getFieldErrors } from "../../services/api";

const messageOf = (error) => (error instanceof ApiError ? getErrorMessage(error) : error?.message || "Something went wrong. Please try again.");
import { TRUCK_STATUS_META } from "../../utils/truckStatus";
import { performTruckOperation, recheck } from "./truckReconcile";
import StatusChangeModal from "./StatusChangeModal";
import TruckDetailsModal from "./TruckDetailsModal";
import TruckFormModal from "./TruckFormModal";
import useTrucks from "./useTrucks";

/**
 * The truck actions shared by the Trucks page and the single-truck page: add / edit, update status, status history.
 * `modals` must be rendered once by the page that uses this hook.
 *
 * Every save goes to the server first. While it runs the form is locked (`submitting`) and a second click is ignored. A success message
 * is shown ONLY after the server confirmed the save; on a refusal the server's own message (and field errors) are shown and the form
 * stays open with what the user typed. Maintenance / service records and truck cost are not available (the server has none).
 */
export default function useTruckManagement() {
  const toast = useToast();
  const data = useTrucks();
  const { trucks, eligibleDrivers, allLabours, isTruckNumberTaken, addTruck, updateTruck, changeStatus, histories, loadHistory } = data;

  const [form, setForm] = useState(null); // { truck: null } = add, { truck } = edit
  const [statusFor, setStatusFor] = useState(null);
  const [detailsFor, setDetailsFor] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const flight = useRef(createSingleFlight()); // blocks a second click before React has re-rendered

  const detailsTruck = detailsFor ? (trucks.find((t) => t.id === detailsFor) ?? null) : null;
  const history = detailsFor ? (histories[detailsFor] ?? { status: "loading", items: [], error: "" }) : null;

  // An UNCERTAIN save (connection lost / timeout / unreadable answer / server error): { op, message }. While set, saving again is blocked.
  const [unconfirmed, setUnconfirmed] = useState(null);

  /** Maps the outcome of a save to what the screen does. Resolves { ok, fieldErrors } (ok = the modal may close). */
  const settle = (outcome, op, { doneText, confirmedText }) => {
    if (outcome.status === "done") {
      setUnconfirmed(null);
      toast.success(doneText(outcome.value));
      return { ok: true };
    }
    if (outcome.status === "refused") {
      // a definite refusal: nothing was saved; the server's message and field errors are shown, the form keeps what was typed
      toast.error(`Not saved: ${messageOf(outcome.error)}`);
      return { ok: false, fieldErrors: getFieldErrors(outcome.error) };
    }
    if (outcome.status === "confirmed") {
      setUnconfirmed(null);
      toast.success(`${confirmedText(outcome.truck)} (confirmed with the server after a connection problem)`);
      return { ok: true };
    }
    if (outcome.status === "not_applied") {
      setUnconfirmed(null);
      toast.error("The connection was lost and the server shows this was NOT saved. You can save again.");
      return { ok: false, fieldErrors: {} };
    }
    // unconfirmed: the server may or may not have saved it. Saving again is blocked until it is settled.
    const message = `The connection was lost, so it is not confirmed whether this was saved.${outcome.why ? ` ${outcome.why}` : ""} Do not save it again yet: press "Check again", or close this window and look at the truck list.`;
    setUnconfirmed({ op, message });
    toast.error("Not confirmed: the connection was lost. Check before saving again.");
    return { ok: false, fieldErrors: {} };
  };

  /** Runs one save through performTruckOperation (one at a time). */
  const run = async (op, action, texts) => {
    if (unconfirmed || flight.current.busy) return { ok: false, fieldErrors: {} };
    setSubmitting(true);
    try {
      return await flight.current.run(async () => {
        return settle(await performTruckOperation({ op, action, reload: data.reload }), op, texts);
      });
    } finally {
      setSubmitting(false);
    }
  };
  /** "Check again": reads the list and reconciles the SAME operation; it never saves anything. */
  const checkAgain = async (texts) => {
    if (!unconfirmed || flight.current.busy) return { ok: false, fieldErrors: {} };
    setSubmitting(true);
    try {
      return await flight.current.run(async () => settle(await recheck({ op: unconfirmed.op, reload: data.reload }), unconfirmed.op, texts));
    } finally {
      setSubmitting(false);
    }
  };

  const formTexts = () => ({
    doneText: (saved) => `${saved.truckNumber} ${form?.truck ? "updated" : "added"}`,
    confirmedText: (saved) => `${saved?.truckNumber ?? "The truck"} ${form?.truck ? "updated" : "added"}`,
  });

  const handleFormSubmit = async (values) => {
    const fields = { truckNumber: values.truckNumber, nickname: values.nickname, model: values.model, capacity: values.capacity, driverId: values.driverId };
    const editing = form.truck ? (trucks.find((t) => t.id === form.truck.id) ?? form.truck) : null;
    const op = editing ? { kind: "update", before: editing, intended: fields } : { kind: "create", before: { ids: trucks.map((t) => t.id) }, intended: fields };
    const result = await run(op, () => (editing ? updateTruck(editing.id, fields) : addTruck(fields)), formTexts());
    if (result.ok) setForm(null);
    return result;
  };

  const handleStatusSubmit = async (id, values) => {
    const before = trucks.find((t) => t.id === id);
    const op = { kind: "status", before, intended: { status: values.status, reason: values.reason } };
    const result = await run(op, () => changeStatus(id, { status: values.status, reason: values.reason, note: values.note, description: values.description }), {
      doneText: ({ truck }) => `${truck.truckNumber}: status changed to ${TRUCK_STATUS_META[truck.status].label}`,
      confirmedText: (truck) => `${before?.truckNumber ?? "Truck"}: status changed to ${TRUCK_STATUS_META[truck?.status ?? values.status].label}`,
    });
    if (result.ok) setStatusFor(null);
    return result;
  };

  const closeForm = () => {
    if (submitting) return;
    setUnconfirmed(null);
    setForm(null);
  };
  const closeStatus = () => {
    if (submitting) return;
    setUnconfirmed(null);
    setStatusFor(null);
  };

  const recheckForm = async () => {
    const result = await checkAgain(formTexts());
    if (result.ok) setForm(null);
  };
  const recheckStatus = async () => {
    const op = unconfirmed?.op;
    const result = await checkAgain({
      doneText: () => "",
      confirmedText: (truck) => `${op?.before?.truckNumber ?? "Truck"}: status changed to ${TRUCK_STATUS_META[truck?.status ?? op?.intended?.status].label}`,
    });
    if (result.ok) setStatusFor(null);
  };

  const openHistory = (truck) => {
    setDetailsFor(truck.id);
    loadHistory(truck.id);
  };

  const modals = (
    <>
      <TruckFormModal
        open={Boolean(form)}
        truck={form?.truck ?? null}
        drivers={eligibleDrivers}
        allLabours={allLabours}
        isTruckNumberTaken={isTruckNumberTaken}
        submitting={submitting}
        unconfirmed={unconfirmed?.message || null}
        onRecheck={recheckForm}
        onClose={closeForm}
        onSubmit={handleFormSubmit}
      />
      <StatusChangeModal
        truck={statusFor ? (trucks.find((t) => t.id === statusFor.id) ?? null) : null}
        submitting={submitting}
        unconfirmed={unconfirmed?.message || null}
        onRecheck={recheckStatus}
        onClose={closeStatus}
        onSubmit={handleStatusSubmit}
      />
      <TruckDetailsModal truck={detailsTruck} history={history} onRetry={() => detailsTruck && loadHistory(detailsTruck.id)} onClose={() => setDetailsFor(null)} />
    </>
  );

  return {
    ...data,
    submitting,
    openAdd: () => { setUnconfirmed(null); setForm({ truck: null }); },
    openEdit: (truck) => { setUnconfirmed(null); setForm({ truck }); },
    openStatus: (truck) => { setUnconfirmed(null); setStatusFor(truck); },
    openHistory,
    modals,
  };
}
