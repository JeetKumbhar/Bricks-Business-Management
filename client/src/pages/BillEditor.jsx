import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, CheckCircle2, Download, Eye, EyeOff, Printer, Save } from "lucide-react";
import { Button, Card, CardBody, CardHeader, ConfirmDialog, DatePicker, EmptyState, Input, LoadingState, Select, useToast } from "../components/ui";
import { useBills } from "../context/BillContext";
import { BILL_STATUS, emptyItemDraft, LIMITS, TAX_MODE, TAX_MODE_LABELS } from "../features/bills/billModel";
import { emptyForm, formFromBill, formSignature, nonLatinFields, previewBillFromForm, taxTypeInfo } from "../features/bills/billForm";
import { billTotals, knownCustomers } from "../features/bills/billSelectors";
import CustomerSection from "../features/bills/CustomerSection";
import InvoicePreview from "../features/bills/InvoicePreview";
import { printInvoice } from "../features/bills/usePrintInvoice";
import { downloadInvoicePdf } from "../features/bills/invoicePdf";
import ItemsEditor from "../features/bills/ItemsEditor";
import SellerSummary from "../features/bills/SellerSummary";
import TotalsPanel from "../features/bills/TotalsPanel";
import { todayBusinessDate } from "../utils/businessDate";
import { finalizeProblems, problemsToErrors, validateBillInput } from "../validators/billValidator";

/** Create a new bill, or edit a DRAFT. Finalized and cancelled bills cannot be opened here. */
export default function BillEditor() {
  const { id } = useParams();
  const { bills, settings, loading } = useBills();
  const today = todayBusinessDate();

  if (loading || !settings) return <LoadingState />;
  const existing = id ? bills.find((b) => b.id === id) : null;
  if (id && (!existing || existing.status !== BILL_STATUS.DRAFT)) {
    return (
      <Card>
        <EmptyState
          title={existing ? "This bill can no longer be edited" : "Bill not found"}
          description={existing ? "Only drafts can be edited. Finalized and cancelled bills are read-only." : "This bill does not exist."}
          action={
            <Link to={existing ? `/bills/${existing.id}` : "/bills"}>
              <Button>{existing ? "View bill" : "Back to bills"}</Button>
            </Link>
          }
        />
      </Card>
    );
  }
  const initial = existing ? formFromBill(existing) : emptyForm({ settings, today });
  return <BillEditorForm key={id ?? "new"} initial={initial} existing={existing} />;
}

function BillEditorForm({ initial, existing }) {
  const navigate = useNavigate();
  const toast = useToast();
  const { bills, settings, saveDraft, finalizeBill } = useBills();
  const today = todayBusinessDate();

  const [form, setForm] = useState(initial);
  const [finalProblems, setFinalProblems] = useState([]);
  const [showErrors, setShowErrors] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [confirmFinalize, setConfirmFinalize] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [baseline, setBaseline] = useState(() => formSignature(initial));
  const savingRef = useRef(false);

  const dirty = formSignature(form) !== baseline;
  const previewBill = useMemo(() => previewBillFromForm(form, settings), [form, settings]);
  const totals = useMemo(() => billTotals(previewBill), [previewBill]);
  const check = useMemo(() => validateBillInput({ ...form, allowedRates: settings.allowedTaxRates }), [form, settings]);
  const savedCustomers = useMemo(() => knownCustomers(bills), [bills]);
  const taxInfo = taxTypeInfo(form, settings.stateCode);
  const hints = [...taxInfo.notices, ...nonLatinFields(form).map((f) => `The ${f} has letters the PDF cannot draw. They will show as "?" in the PDF (the on-screen invoice and printing are fine).`)];
  // what the backend needs before a bill can be finalized (only meaningful once the typed values are valid)
  const problems = useMemo(() => (check.valid ? finalizeProblems({ ...check.value, items: check.value.items }, settings, today) : []), [check, settings, today]);
  const marked = useMemo(() => problemsToErrors(problems, form.items.length), [problems, form.items.length]);

  useEffect(() => {
    if (!dirty) return undefined;
    const warn = (e) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const setCustomer = (patch) => setForm((f) => ({ ...f, customer: { ...f.customer, ...patch } }));
  const setItem = (index, patch) => setForm((f) => ({ ...f, items: f.items.map((it, i) => (i === index ? { ...it, ...patch } : it)) }));
  const addItem = () => setForm((f) => ({ ...f, items: [...f.items, emptyItemDraft({ taxRate: f.items[f.items.length - 1]?.taxRate ?? "" })] }));
  const removeItem = (index) => setForm((f) => ({ ...f, items: f.items.filter((_, i) => i !== index) }));

  const persist = () => saveDraft({ id: existing?.id, revision: existing?.revision, billDate: form.billDate, customer: form.customer, items: form.items, taxMode: form.taxMode, notes: form.notes });

  const run = async (action, { complete = false } = {}) => {
    if (savingRef.current) return false;
    setShowErrors(true);
    if (!check.valid) {
      toast.error(check.errors.billDate ?? check.errors.items ?? "Some fields need attention. Fix the highlighted fields and try again");
      return false;
    }
    if (complete && problems.length > 0) {
      setFinalProblems(problems);
      toast.error(problems[0].message);
      return false;
    }
    setFinalProblems([]);
    savingRef.current = true;
    setSaving(true);
    try {
      await action();
      return true;
    } catch (error) {
      if (error?.problems) setFinalProblems(error.problems);
      toast.error(error?.message ?? "Could not save the bill");
      return false;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const onSaveDraft = () =>
    run(async () => {
      const bill = await persist();
      setBaseline(formSignature(form));
      toast.success("Draft saved (kept in this browser only)");
      navigate(`/bills/${bill.id}`);
    });

  const onFinalize = () => {
    setConfirmFinalize(false);
    return run(
      async () => {
        const draft = await persist();
        const bill = await finalizeBill(draft.id, { revision: draft.revision });
        setBaseline(formSignature(form));
        toast.success(`Bill ${bill.billNumber} finalized`);
        navigate(`/bills/${bill.id}`);
      },
      { complete: true }
    );
  };

  const onFinalizeClick = () => {
    setShowErrors(true);
    if (!check.valid) return run(() => null);
    if (problems.length > 0) {
      setFinalProblems(problems);
      toast.error(problems[0].message);
      return undefined;
    }
    setFinalProblems([]);
    return setConfirmFinalize(true);
  };

  const goBack = () => (dirty ? setConfirmDiscard(true) : navigate(existing ? `/bills/${existing.id}` : "/bills"));
  // after a failed finalize the missing fields are marked too, merged with the format errors
  const showFinal = showErrors && finalProblems.length > 0;
  const customerErrors = showErrors ? { ...(showFinal ? marked.customerErrors : {}), ...check.customerErrors } : {};
  const itemErrors = form.items.map((_, i) => (showErrors ? { ...(showFinal ? marked.itemErrors[i] : {}), ...(check.itemErrors[i] ?? {}) } : {}));
  const fieldErrors = showErrors ? { ...(showFinal ? marked.errors : {}), ...check.errors } : {};
  const sellerProblems = showFinal ? marked.sellerProblems : [];

  return (
    <div className="space-y-4 sm:space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <button type="button" onClick={goBack} className="mb-1 inline-flex items-center gap-1.5 py-1 text-sm font-medium text-primary">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Bills
          </button>
          <h1 className="type-page-heading">{existing ? "Edit Draft Bill" : "Create New Bill"}</h1>
          <p className="mt-1 text-sm text-fg-muted">Fill the sections, check the preview, then save as a draft or finalize.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 lg:gap-5">
        <div className="space-y-4 sm:space-y-5 lg:col-span-2">
          <SellerSummary settings={settings} />
          <CustomerSection customer={form.customer} errors={customerErrors} savedCustomers={savedCustomers} onChange={setCustomer} gst={form.taxMode === TAX_MODE.GST} />

          <Card>
            <CardHeader title="Invoice Details" subtitle="Date, invoice type and notes" />
            <CardBody className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <DatePicker label="Bill Date" required max={today} value={form.billDate} onChange={(e) => set({ billDate: e.target.value })} error={fieldErrors.billDate} hint="India time (IST)" />
              <Select
                label="Invoice type"
                required
                value={form.taxMode}
                onChange={(e) => set({ taxMode: e.target.value })}
                options={Object.entries(TAX_MODE_LABELS).map(([value, label]) => ({ value, label }))}
                error={fieldErrors.taxMode}
                hint="No tax rate is assumed. Enter the rate for each item of a GST bill."
              />
              <div className="sm:col-span-2">
                <p className="text-sm font-medium text-fg-muted">Tax applied</p>
                <p className="rounded-lg bg-background px-3 py-2 text-sm font-medium" aria-live="polite">{taxInfo.label}</p>
                <p className="type-small mt-1">CGST + SGST or IGST is worked out from your state code and the customer's state code. It cannot be picked by hand.</p>
              </div>
              <Input label="Notes" placeholder="Optional (not printed)" maxLength={LIMITS.notes} value={form.notes} onChange={(e) => set({ notes: e.target.value })} wrapperClassName="sm:col-span-2" />
              <p className="type-small sm:col-span-2">
                Status: <strong>Draft</strong> until you finalize it. The bill number is given when you finalize.
              </p>
            </CardBody>
          </Card>

          <ItemsEditor items={form.items} errors={itemErrors} taxMode={form.taxMode} totals={totals} units={settings.units} onChange={setItem} onAdd={addItem} onRemove={removeItem} listError={fieldErrors.items} />
        </div>

        <div className="space-y-4 sm:space-y-5 lg:sticky lg:top-20 lg:self-start">
          <TotalsPanel totals={totals} taxMode={form.taxMode} />
          {sellerProblems.length > 0 && (
            <div className="space-y-1 rounded-lg bg-danger-soft px-4 py-3 text-sm text-danger" role="alert">
              {[...new Set(sellerProblems)].map((m) => (
                <p key={m}>{m}</p>
              ))}
              <Link to="/settings#invoice-settings" className="font-medium underline">Open Invoice Settings</Link>
            </div>
          )}
          {hints.length > 0 && (
            <div className="space-y-1 rounded-lg bg-warning-soft px-4 py-3 text-sm text-amber-700" role="status">
              {hints.map((h) => (
                <p key={h}>{h}</p>
              ))}
            </div>
          )}
          <Card>
            <CardBody className="space-y-2">
              <Button className="w-full" leftIcon={CheckCircle2} onClick={onFinalizeClick} disabled={saving}>
                Finalize Invoice
              </Button>
              <Button className="w-full" variant="secondary" leftIcon={Save} onClick={onSaveDraft} loading={saving}>
                Save as Draft
              </Button>
              <Button className="w-full" variant="outline" leftIcon={showPreview ? EyeOff : Eye} onClick={() => setShowPreview((v) => !v)}>
                {showPreview ? "Hide Preview" : "Preview Invoice"}
              </Button>
              <Button className="w-full" variant="ghost" onClick={goBack} disabled={saving}>
                Cancel / Go Back
              </Button>
              {dirty && <p className="type-small text-center">You have unsaved changes.</p>}
            </CardBody>
          </Card>
        </div>
      </div>

      {showPreview && (
        <Card>
          <CardHeader
            title="Invoice Preview"
            subtitle="Exactly what is printed. It matches your printed bill book."
            action={
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" leftIcon={Printer} onClick={printInvoice}>
                  Print
                </Button>
                <Button variant="outline" size="sm" leftIcon={Download} onClick={() => downloadInvoicePdf(previewBill)}>
                  Download PDF
                </Button>
              </div>
            }
          />
          <CardBody className="bg-background">
            <InvoicePreview bill={previewBill} />
          </CardBody>
        </Card>
      )}

      <ConfirmDialog
        open={confirmFinalize}
        title="Finalize this invoice?"
        message="Please check the customer, the items and the GST. After finalizing, the bill gets its number and cannot be edited (it can only be cancelled). The business and bank details from Settings are fixed on this invoice now."
        confirmText="Finalize"
        onConfirm={onFinalize}
        onCancel={() => setConfirmFinalize(false)}
      />
      <ConfirmDialog
        open={confirmDiscard}
        title="Discard your changes?"
        message="You have unsaved changes on this bill. If you leave now they will be lost."
        confirmText="Discard changes"
        variant="danger"
        onConfirm={() => navigate(existing ? `/bills/${existing.id}` : "/bills")}
        onCancel={() => setConfirmDiscard(false)}
      />
    </div>
  );
}
