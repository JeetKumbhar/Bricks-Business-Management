import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FilePlus2, FileText, Plus, RotateCcw } from "lucide-react";
import { Button, Card, CardBody, ConfirmDialog, DatePicker, EmptyState, LoadingState, Select, SearchInput, useToast } from "../components/ui";
import BillSummaryCards from "../features/bills/BillSummaryCards";
import BillsTable from "../features/bills/BillsTable";
import { BILL_STATUS, STATUS_META } from "../features/bills/billModel";
import { finalizeErrorText } from "../features/bills/billForm";
import { billLabel, filterBills, sortBills, summarizeBills } from "../features/bills/billSelectors";
import { usePrintBill } from "../features/bills/usePrintInvoice";
import { downloadInvoicePdf } from "../features/bills/invoicePdf";
import { useBills } from "../context/BillContext";

const NO_FILTERS = { search: "", from: "", to: "", status: "" };

/**
 * Bills: create and manage customer invoices. The list comes from the server (customer, number, date, status and the server's totals);
 * a bill's items are read from the server only when it is printed or downloaded.
 */
export default function Bills() {
  const navigate = useNavigate();
  const toast = useToast();
  const { bills, loading, loadError, reload, loadBill, finalizeBill, cancelBill, discardDraft } = useBills();
  const { print, host } = usePrintBill();
  const [filters, setFilters] = useState(NO_FILTERS);
  const [finalizing, setFinalizing] = useState(null);
  const [cancelling, setCancelling] = useState(null);

  const summary = useMemo(() => summarizeBills(bills), [bills]);
  const visible = useMemo(() => sortBills(filterBills(bills, filters)), [bills, filters]);
  const filtered = Object.values(filters).some(Boolean);
  const set = (patch) => setFilters((f) => ({ ...f, ...patch }));
  const rangeError = filters.from && filters.to && filters.to < filters.from ? "The end date is before the start date." : null;

  const confirmFinalize = async () => {
    const bill = finalizing;
    setFinalizing(null);
    try {
      const done = await finalizeBill(bill.id, { revision: bill.revision });
      toast.success(`Bill ${done.billNumber} finalized`);
    } catch (error) {
      toast.error(finalizeErrorText(error));
    }
  };

  const confirmCancel = async (reason) => {
    const bill = cancelling;
    setCancelling(null);
    try {
      if (bill.status === BILL_STATUS.DRAFT) {
        await discardDraft(bill.id);
        toast.success("Draft discarded");
      } else {
        await cancelBill(bill.id, reason);
        toast.success(`Bill ${bill.billNumber} cancelled`);
      }
    } catch (error) {
      toast.error(error?.message ?? "Could not cancel the bill");
    }
  };

  // the list has no items, so the full bill is read from the server first (print and PDF always use the server's data)
  const withFullBill = async (row, onLoaded) => {
    try {
      onLoaded(await loadBill(row.id));
    } catch (error) {
      toast.error(error?.message ?? "Could not load the bill");
    }
  };
  const printRow = (row) => withFullBill(row, print);
  const download = (row) =>
    withFullBill(row, (bill) => {
      try {
        downloadInvoicePdf(bill);
        toast.success("PDF downloaded");
      } catch (error) {
        toast.error(error?.message ?? "Could not create the PDF");
      }
    });

  if (loading) return <LoadingState />;

  return (
    <div className="space-y-4 sm:space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="type-page-heading">Bills</h1>
          <p className="mt-1 text-sm text-fg-muted">Create and manage customer invoices.</p>
        </div>
        <div className="flex flex-wrap gap-2 self-start">
          <Button variant="outline" leftIcon={FilePlus2} onClick={() => navigate("/bills/from-pheeras")} size="lg">
            Bill from Pheeras
          </Button>
          <Button leftIcon={Plus} onClick={() => navigate("/bills/new")} size="lg">
            Create New Bill
          </Button>
        </div>
      </div>

      {loadError && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-danger-soft px-4 py-3 text-sm text-danger">
          <span>Could not load bills: {loadError}</span>
          <Button variant="outline" size="sm" onClick={reload}>
            Try again
          </Button>
        </div>
      )}

      <BillSummaryCards summary={summary} />

      <Card>
        <CardBody className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <SearchInput value={filters.search} onChange={(v) => set({ search: v })} placeholder="Search bill number or customer..." className="sm:col-span-2 lg:col-span-1 lg:self-end" />
            <DatePicker label="From" value={filters.from} onChange={(e) => set({ from: e.target.value })} />
            <DatePicker label="To" value={filters.to} onChange={(e) => set({ to: e.target.value })} />
            <Select
              label="Status"
              placeholder="All statuses"
              value={filters.status}
              onChange={(e) => set({ status: e.target.value })}
              options={Object.values(BILL_STATUS).map((s) => ({ value: s, label: STATUS_META[s].label }))}
            />
          </div>
          <div className="flex items-center justify-between gap-3">
            <p className="type-small" aria-live="polite">
              {rangeError ?? `${visible.length} of ${bills.length} bills`}
            </p>
            {filtered && (
              <Button variant="outline" size="sm" leftIcon={RotateCcw} onClick={() => setFilters(NO_FILTERS)}>
                Reset filters
              </Button>
            )}
          </div>
        </CardBody>
      </Card>

      {bills.length === 0 && loadError ? null : bills.length === 0 ? (
        <Card>
          <EmptyState
            icon={FileText}
            title="No bills yet"
            description="Create your first invoice. It can be saved as a draft, finalized, printed or downloaded as a PDF."
            action={<Button leftIcon={Plus} onClick={() => navigate("/bills/new")}>Create New Bill</Button>}
          />
        </Card>
      ) : visible.length === 0 ? (
        <Card>
          <EmptyState icon={FileText} title="No bills match" description="Try different search words, dates or status." action={<Button variant="outline" onClick={() => setFilters(NO_FILTERS)}>Reset filters</Button>} />
        </Card>
      ) : (
        <Card>
          <CardBody>
            <BillsTable
              bills={visible}
              onView={(b) => navigate(`/bills/${b.id}`)}
              onEdit={(b) => navigate(`/bills/${b.id}/edit`)}
              onPrint={printRow}
              onDownload={download}
              onFinalize={setFinalizing}
              onCancel={setCancelling}
            />
          </CardBody>
        </Card>
      )}

      <ConfirmDialog
        open={Boolean(finalizing)}
        title="Finalize this bill?"
        message={finalizing ? `The draft for ${finalizing.customer.name || "this customer"} will get its bill number and become read-only. The business and bank details are fixed on the invoice at this moment.` : ""}
        confirmText="Finalize"
        onConfirm={confirmFinalize}
        onCancel={() => setFinalizing(null)}
      />
      <ConfirmDialog
        open={Boolean(cancelling)}
        title={cancelling?.status === BILL_STATUS.DRAFT ? "Discard this draft?" : "Cancel this bill?"}
        message={cancelling ? (cancelling.status === BILL_STATUS.DRAFT ? "The draft will be removed. It never had a bill number, so no number is lost." : `Bill ${billLabel(cancelling)} will be marked Cancelled and no longer counts as invoiced. It stays in the list for the record and its number is not reused.`) : ""}
        confirmText={cancelling?.status === BILL_STATUS.DRAFT ? "Discard draft" : "Cancel bill"}
        variant="danger"
        requireReason={cancelling?.status !== BILL_STATUS.DRAFT}
        reasonLabel="Reason for cancelling"
        onConfirm={confirmCancel}
        onCancel={() => setCancelling(null)}
      />
      {host}
    </div>
  );
}
