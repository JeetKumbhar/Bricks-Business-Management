import { useMemo, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { Button, ConfirmDialog, useToast } from "../components/ui";
import DeletedPaymentsCard from "../features/payments/DeletedPaymentsCard";
import PaymentFilters from "../features/payments/PaymentFilters";
import PaymentFormModal from "../features/payments/PaymentFormModal";
import PaymentHistory from "../features/payments/PaymentHistory";
import PaymentRevisionsModal from "../features/payments/PaymentRevisionsModal";
import { filterPayments, sumAmount, sumSince } from "../features/payments/paymentSelectors";
import PaymentSummaryTiles from "../features/payments/PaymentSummaryTiles";
import usePayments from "../features/payments/usePayments";
import { getErrorMessage } from "../services/api";
import { getPaymentDetail, makeRequestId } from "../services/paymentApi";
import { formatCurrency } from "../utils/formatCurrency";
import { addDaysISO, formatDate, toISODate } from "../utils/formatDate";
import { PAYMENT_TYPES } from "../utils/paymentTypes";

/**
 * Payments for every recipient: Bigari workers, Maapvali workers and Patlavale teams.
 * A payment is a money transaction only. It never changes attendance, maap entries or production.
 */
export default function Payments() {
  const toast = useToast();
  const { history, deleted, labours, addPayment, updatePayment, deletePayment } = usePayments();

  const [search, setSearch] = useState("");
  const [type, setType] = useState("ALL");
  const [page, setPage] = useState(1);

  // null = closed, { payment: null } = add, { payment } = edit
  const [form, setForm] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [viewingChanges, setViewingChanges] = useState(null);
  const [saving, setSaving] = useState(false); // a request is in flight: blocks a second click
  const requestIdRef = useRef(null); // one id per "Add payment" window: a retry or double click can never record it twice

  const today = toISODate();
  const searched = useMemo(() => filterPayments(history, { search }), [history, search]);
  const filtered = useMemo(() => (type === "ALL" ? searched : searched.filter((p) => p.type === type)), [searched, type]);

  const counts = useMemo(
    () => ({
      ALL: searched.length,
      [PAYMENT_TYPES.BOOKING_ADVANCE]: searched.filter((p) => p.type === PAYMENT_TYPES.BOOKING_ADVANCE).length,
      [PAYMENT_TYPES.SALARY_PAYMENT]: searched.filter((p) => p.type === PAYMENT_TYPES.SALARY_PAYMENT).length,
      [PAYMENT_TYPES.OTHER]: searched.filter((p) => p.type === PAYMENT_TYPES.OTHER).length,
    }),
    [searched]
  );

  const paidToday = useMemo(() => sumAmount(history.filter((p) => p.date === today)), [history, today]);
  const paidLast7 = useMemo(() => sumSince(history, addDaysISO(today, -6)), [history, today]);
  const hasFilters = search.trim() !== "" || type !== "ALL";

  const handleSearch = (value) => {
    setSearch(value);
    setPage(1);
  };
  const handleType = (value) => {
    setType(value);
    setPage(1);
  };
  const clearFilters = () => {
    setSearch("");
    setType("ALL");
    setPage(1);
  };

  // Every change is saved on the server first. The window closes and "saved" shows only after the server confirms; on a failure
  // the window stays open with everything typed, and the server's reason is shown.
  const runRequest = async (action, failure) => {
    if (saving) return;
    setSaving(true);
    try {
      await action();
    } catch (err) {
      toast.error(getErrorMessage(err, failure));
    } finally {
      setSaving(false);
    }
  };

  const openAdd = () => {
    requestIdRef.current = makeRequestId();
    setForm({ payment: null });
  };

  const handleSubmit = (values) =>
    runRequest(async () => {
      const recipientName = labours.find((l) => l.id === values.labourId)?.name ?? values.labourId;

      if (form.payment) {
        await updatePayment(form.payment.id, { type: values.type, amount: values.amount, date: values.date, note: values.note }, values.reason);
        toast.success("Payment corrected");
      } else {
        await addPayment({ labourId: values.labourId, type: values.type, amount: values.amount, date: values.date, note: values.note }, requestIdRef.current);
        requestIdRef.current = null;
        setPage(1);
        toast.success(`${formatCurrency(values.amount)} recorded for ${recipientName}`);
      }
      setForm(null);
    }, "Could not save the payment. Nothing was saved.");

  const handleDelete = (reason) =>
    runRequest(async () => {
      await deletePayment(deleting.id, reason);
      toast.success("Payment deleted. It stays on record.");
      setDeleting(null);
    }, "Could not delete the payment. Nothing was changed.");

  // The list does not carry the correction trail; it is read from the server when "View changes" is opened.
  const handleViewChanges = async (payment) => {
    try {
      const detail = await getPaymentDetail(payment.id);
      setViewingChanges({ ...payment, ...detail, labourName: payment.labourName, labourType: payment.labourType });
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not load the changes."));
    }
  };

  return (
    <div className="space-y-4 sm:space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="type-page-heading">Payments</h1>
          <p className="mt-1 text-sm text-fg-muted">
            Bayana, salary payments and other money given to workers and Patlavale teams.
          </p>
        </div>
        <Button leftIcon={Plus} onClick={openAdd} className="hidden self-start sm:inline-flex">
          Add Payment
        </Button>
      </div>

      <PaymentSummaryTiles today={paidToday} last7Days={paidLast7} shown={sumAmount(filtered)} />

      <PaymentFilters search={search} onSearchChange={handleSearch} type={type} onTypeChange={handleType} counts={counts} />

      <PaymentHistory
        payments={filtered}
        page={page}
        onPageChange={setPage}
        onEdit={(payment) => setForm({ payment })}
        onDelete={setDeleting}
        onViewChanges={handleViewChanges}
        hasFilters={hasFilters}
        onClearFilters={clearFilters}
      />

      <DeletedPaymentsCard deleted={deleted} />

      {/* Phones: floating add button above the bottom nav */}
      <button
        type="button"
        aria-label="Add payment"
        onClick={openAdd}
        className="fixed bottom-[calc(4.75rem+env(safe-area-inset-bottom))] right-4 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-white shadow-pop transition-transform active:scale-95 sm:hidden"
      >
        <Plus className="h-6 w-6" aria-hidden="true" />
      </button>

      <PaymentFormModal open={Boolean(form)} payment={form?.payment ?? null} labours={labours} onClose={() => setForm(null)} onSubmit={handleSubmit} saving={saving} />

      <PaymentRevisionsModal payment={viewingChanges} onClose={() => setViewingChanges(null)} />

      <ConfirmDialog
        open={Boolean(deleting)}
        variant="danger"
        title="Delete payment?"
        message={
          deleting
            ? `${formatCurrency(deleting.amount)} paid to ${deleting.labourName} on ${formatDate(deleting.date)} will be removed from the balance. The record stays under "Deleted payments" and in the audit log.`
            : ""
        }
        confirmText="Delete"
        requireReason
        reasonLabel="Reason for deleting"
        loading={saving}
        onConfirm={handleDelete}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}
