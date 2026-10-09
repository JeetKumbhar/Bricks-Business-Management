import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { Button, ConfirmDialog, useToast } from "../components/ui";
import PaymentFilters from "../features/payments/PaymentFilters";
import PaymentFormModal from "../features/payments/PaymentFormModal";
import PaymentHistory from "../features/payments/PaymentHistory";
import { filterPayments, sumAmount, sumSince } from "../features/payments/paymentSelectors";
import PaymentSummaryTiles from "../features/payments/PaymentSummaryTiles";
import usePayments from "../features/payments/usePayments";
import { formatCurrency } from "../utils/formatCurrency";
import { addDaysISO, formatDate, toISODate } from "../utils/formatDate";
import { PAYMENT_TYPES } from "../utils/paymentTypes";

export default function Payments() {
  const toast = useToast();
  const { history, labours, addPayment, updatePayment, deletePayment } = usePayments();

  const [search, setSearch] = useState("");
  const [type, setType] = useState("ALL");
  const [page, setPage] = useState(1);

  // null = closed, { payment: null } = add, { payment } = edit
  const [form, setForm] = useState(null);
  const [deleting, setDeleting] = useState(null);

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

  const handleSubmit = (values) => {
    const labourName = labours.find((l) => l.id === values.labourId)?.name ?? values.labourId;

    if (form.payment) {
      updatePayment(
        form.payment.id,
        { type: values.type, amount: values.amount, date: values.date, note: values.note },
        values.reason
      );
      toast.success("Payment corrected");
    } else {
      addPayment({
        labourId: values.labourId,
        type: values.type,
        amount: values.amount,
        date: values.date,
        note: values.note,
      });
      setPage(1);
      toast.success(`${formatCurrency(values.amount)} recorded for ${labourName}`);
    }
    setForm(null);
  };

  const handleDelete = (reason) => {
    deletePayment(deleting.id, reason);
    toast.success("Payment deleted");
    setDeleting(null);
  };

  return (
    <div className="space-y-4 sm:space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="type-page-heading">Payments</h1>
          <p className="mt-1 text-sm text-fg-muted">Booking advances, salary payments and other money given to labour.</p>
        </div>
        <Button leftIcon={Plus} onClick={() => setForm({ payment: null })} className="hidden self-start sm:inline-flex">
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
        hasFilters={hasFilters}
        onClearFilters={clearFilters}
      />

      {/* Phones: floating add button above the bottom nav */}
      <button
        type="button"
        aria-label="Add payment"
        onClick={() => setForm({ payment: null })}
        className="fixed bottom-[calc(4.75rem+env(safe-area-inset-bottom))] right-4 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-white shadow-pop transition-transform active:scale-95 sm:hidden"
      >
        <Plus className="h-6 w-6" aria-hidden="true" />
      </button>

      <PaymentFormModal open={Boolean(form)} payment={form?.payment ?? null} labours={labours} onClose={() => setForm(null)} onSubmit={handleSubmit} />

      <ConfirmDialog
        open={Boolean(deleting)}
        variant="danger"
        title="Delete payment?"
        message={
          deleting
            ? `${formatCurrency(deleting.amount)} paid to ${deleting.labourName} on ${formatDate(deleting.date)} will be removed and the balance recalculated. This is recorded in the audit log.`
            : ""
        }
        confirmText="Delete"
        requireReason
        reasonLabel="Reason for deleting"
        onConfirm={handleDelete}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}
