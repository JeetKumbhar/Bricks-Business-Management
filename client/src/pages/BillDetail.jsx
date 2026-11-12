import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Ban, CheckCircle2, Download, Pencil, Printer } from "lucide-react";
import { Badge, Button, Card, CardBody, CardHeader, ConfirmDialog, EmptyState, LoadingState, useToast } from "../components/ui";
import { useBills } from "../context/BillContext";
import useBillDetail from "../features/bills/useBillDetail";
import BillPheeraPanel from "../features/bills/BillPheeraPanel";
import { useTruckTripStore } from "../context/TruckTripContext";
import { BILL_STATUS, TAX_MODE_LABELS, TAX_TYPE_LABELS } from "../features/bills/billModel";
import { billLabel, billTotals } from "../features/bills/billSelectors";
import BillStatusBadge from "../features/bills/BillStatusBadge";
import InvoicePreview from "../features/bills/InvoicePreview";
import { printInvoice } from "../features/bills/usePrintInvoice";
import { finalizeErrorText } from "../features/bills/billForm";
import { downloadInvoicePdf } from "../features/bills/invoicePdf";
import { taxRows } from "../features/bills/invoiceFormat";
import { formatDate } from "../utils/formatDate";
import { formatRupees } from "../utils/money";

const stamp = (iso) => (iso ? new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" }) : "");

/** One bill: details, items, calculations, the invoice itself, and print / PDF. Only drafts can be edited. */
export default function BillDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { finalizeBill, cancelBill, discardDraft, reload: reloadBills } = useBills();
  const { reload: reloadPheeras } = useTruckTripStore();
  const { bill, loading, error: loadError, reload, setBill } = useBillDetail(id);
  const [finalizing, setFinalizing] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  if (loading && !bill) return <LoadingState />;
  if (loadError) {
    return (
      <Card>
        <EmptyState title="Could not load this bill" description={loadError} action={<Button onClick={reload}>Try again</Button>} />
      </Card>
    );
  }
  if (!bill) {
    return (
      <Card>
        <EmptyState title="Bill not found" description="This bill does not exist." action={<Link to="/bills"><Button>Back to bills</Button></Link>} />
      </Card>
    );
  }

  const totals = billTotals(bill);
  const draft = bill.status === BILL_STATUS.DRAFT;
  const rows = taxRows(totals);
  const label = billLabel(bill);

  const doFinalize = async () => {
    setFinalizing(false);
    try {
      const result = await finalizeBill(bill.id, { revision: bill.revision });
      setBill(result); // the bill exactly as the server now holds it
      toast.success(`Bill ${result.billNumber} finalized`);
    } catch (error) {
      toast.error(finalizeErrorText(error));
      if (error?.status === 409 || error?.isConnectionProblem) reload(); // somebody changed it, or the outcome is unsure: show what the server holds
    }
  };
  // a draft has no number and was never issued, so it is discarded; only a finalized bill is cancelled (with a reason)
  const doCancel = async (reason) => {
    setCancelling(false);
    try {
      if (draft) {
        await discardDraft(bill.id);
        toast.success("Draft discarded");
        navigate("/bills");
      } else {
        setBill(await cancelBill(bill.id, reason));
        toast.success(`Bill ${bill.billNumber} cancelled. It stays in the list for the record.`);
      }
    } catch (error) {
      toast.error(error?.message ?? "Could not cancel");
      if (error?.status === 409 || error?.isConnectionProblem) reload();
    }
  };
  const download = () => {
    try {
      downloadInvoicePdf(bill);
      toast.success("PDF downloaded");
    } catch (error) {
      toast.error(error?.message ?? "Could not create the PDF");
    }
  };

  return (
    <div className="space-y-4 sm:space-y-5">
      <Link to="/bills" className="inline-flex items-center gap-1.5 py-1 text-sm font-medium text-primary">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Bills
      </Link>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="type-page-heading">{label}</h1>
            <BillStatusBadge status={bill.status} />
            {bill.isDemo && <Badge variant="neutral" size="sm">Demo data</Badge>}
          </div>
          <p className="mt-1 text-sm text-fg-muted">
            {bill.customer.name} - {formatDate(bill.billDate)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {draft && (
            <>
              <Button leftIcon={CheckCircle2} onClick={() => setFinalizing(true)}>Finalize</Button>
              <Button variant="outline" leftIcon={Pencil} onClick={() => navigate(`/bills/${bill.id}/edit`)}>Edit</Button>
            </>
          )}
          <Button variant="outline" leftIcon={Printer} onClick={printInvoice}>Print</Button>
          <Button variant="outline" leftIcon={Download} onClick={download}>Download PDF</Button>
          {bill.status !== BILL_STATUS.CANCELLED && (
            <Button variant="outline" leftIcon={Ban} onClick={() => setCancelling(true)}>{draft ? "Discard draft" : "Cancel bill"}</Button>
          )}
        </div>
      </div>

      {bill.status === BILL_STATUS.CANCELLED && (
        <p role="status" className="rounded-lg bg-danger-soft px-4 py-3 text-sm text-danger">
          This bill was cancelled{bill.cancelledAt ? ` on ${stamp(bill.cancelledAt)}` : ""}. Reason: {bill.cancelledReason}. It is kept for the record and no longer counts as invoiced.
        </p>
      )}
      {bill.status === BILL_STATUS.FINAL && <p className="type-small">This bill is finalized and read-only.{bill.finalizedBy ? ` Finalized by ${bill.finalizedBy}.` : ""}</p>}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Customer and invoice" />
          <CardBody>
            <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
              {[
                ["Customer (M/s.)", bill.customer.name],
                ["Address", bill.customer.address || "-"],
                ["GSTIN", bill.customer.gstin || "Not given"],
                ["State / code", [bill.customer.stateName, bill.customer.stateCode].filter(Boolean).join(" / ") || "-"],
                ["Contact", bill.customer.contact || "-"],
                ["Invoice type", TAX_MODE_LABELS[bill.taxMode]],
                ["Tax applied", bill.taxMode !== "GST" ? "None" : totals.taxType ? TAX_TYPE_LABELS[totals.taxType] : "Not known yet (state code missing)"],
                ["Created", stamp(bill.createdAt)],
                ["Last updated", stamp(bill.updatedAt)],
                ...(bill.finalizedAt ? [["Finalized", stamp(bill.finalizedAt)]] : []),
                ...(bill.notes ? [["Notes", bill.notes]] : []),
              ].map(([k, v]) => (
                <div key={k}>
                  <dt className="text-fg-muted">{k}</dt>
                  <dd className="font-medium">{v}</dd>
                </div>
              ))}
            </dl>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Calculation" />
          <CardBody>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between gap-3"><dt className="text-fg-muted">Taxable amount</dt><dd className="font-medium">{formatRupees(totals.taxablePaise)}</dd></div>
              {rows.map((r) => (
                <div key={r.key} className="flex justify-between gap-3"><dt className="text-fg-muted">{r.label}</dt><dd className="font-medium">{formatRupees(r.paise)}</dd></div>
              ))}
              <div className="flex items-baseline justify-between gap-3 border-t border-border pt-2"><dt className="font-semibold">Grand total</dt><dd className="text-xl font-bold">{formatRupees(totals.grandPaise)}</dd></div>
            </dl>
          </CardBody>
        </Card>
      </div>

      {((bill.sourceTripIds?.length ?? 0) > 0 || draft) && (
        <BillPheeraPanel
          bill={bill}
          onBillChange={setBill}
          onPheerasChanged={() => {
            reloadBills(); // the list shows the new totals
            reloadPheeras(); // the Pheera screens show the new reservation status
          }}
        />
      )}

      <Card>
        <CardHeader title="Invoice" subtitle="Same as the printed and PDF copy" />
        <CardBody className="bg-background">
          <InvoicePreview bill={bill} />
        </CardBody>
      </Card>

      <ConfirmDialog open={finalizing} title="Finalize this bill?" message="The bill will get its number and become read-only. The business and bank details are fixed on the invoice now." confirmText="Finalize" onConfirm={doFinalize} onCancel={() => setFinalizing(false)} />
      <ConfirmDialog
        open={cancelling}
        title={draft ? "Discard this draft?" : "Cancel this bill?"}
        message={draft ? "The draft will be removed. It never had a bill number, so no number is lost." : "The bill will be marked Cancelled and no longer counts as invoiced. It stays in the list and its number is not reused."}
        confirmText={draft ? "Discard draft" : "Cancel bill"}
        variant="danger"
        requireReason={!draft}
        reasonLabel="Reason for cancelling"
        onConfirm={doCancel}
        onCancel={() => setCancelling(false)}
      />
    </div>
  );
}
