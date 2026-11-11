import { useState } from "react";
import { FileText } from "lucide-react";
import { Button, Card, CardBody, CardHeader, Input, LoadingState, Select, Textarea, useToast } from "../../components/ui";
import { useBills } from "../../context/BillContext";
import { getFieldErrors } from "../../services/api";
import { financialYear, formatBillNumber } from "../bills/billNumbering";
import { TAX_MODE_LABELS } from "../bills/billModel";
import { todayBusinessDate } from "../../utils/businessDate";
import { validateInvoiceSettings } from "../../validators/billValidator";

// The settings use the backend shape (phones, tax rates and units are lists, bank and numbering are objects).
// The form keeps lists as comma separated text and the padding as text, and converts back when saving.
const list = (text) => String(text ?? "").split(/[,;\n]+/).map((x) => x.trim()).filter(Boolean);
const toForm = (s) => ({ ...s, phones: (s.phones ?? []).join(", "), allowedTaxRates: (s.allowedTaxRates ?? []).join(", "), units: (s.units ?? []).join(", "), numbering: { ...s.numbering, padding: String(s.numbering.padding) } });
const fromForm = (f) => ({
  ...f,
  phones: list(f.phones),
  allowedTaxRates: list(f.allowedTaxRates).map((r) => (/^(\d+\.?\d*|\.\d+)$/.test(r) ? Number(r) : NaN)),
  units: list(f.units),
  numbering: { ...f.numbering, padding: /^[1-8]$/.test(String(f.numbering.padding).trim()) ? Number(f.numbering.padding) : NaN },
});

/**
 * Invoice / Business Details: the ONE place the seller and bank details printed on invoices come from.
 * Bills already finalized keep the details they were finalized with; a change here only affects drafts and new bills.
 */
export default function InvoiceSettingsSection() {
  const { settings, settingsError, loading, reload, saveSettings } = useBills();
  // the settings load a moment after the app starts; the form is built only once they are there
  if (!settings && settingsError && !loading) {
    return (
      <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-danger-soft px-4 py-3 text-sm text-danger">
        <span>Invoice settings could not be loaded: {settingsError}</span>
        <Button variant="outline" size="sm" onClick={reload}>Try again</Button>
      </div>
    );
  }
  if (!settings) return <LoadingState />;
  return <InvoiceSettingsForm settings={settings} saveSettings={saveSettings} />;
}

function InvoiceSettingsForm({ settings, saveSettings }) {
  const toast = useToast();
  const [form, setForm] = useState(() => toForm(settings));
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const setBank = (key) => (e) => setForm((f) => ({ ...f, bank: { ...f.bank, [key]: e.target.value } }));
  const setNumbering = (key) => (e) => setForm((f) => ({ ...f, numbering: { ...f.numbering, [key]: key === "includeFinancialYear" ? e.target.value === "yes" : e.target.value } }));
  const dirty = JSON.stringify(form) !== JSON.stringify(toForm(settings));

  const onSave = async () => {
    const candidate = fromForm(form);
    const check = validateInvoiceSettings(candidate);
    const next = { ...check.errors };
    if (Number.isNaN(candidate.numbering.padding)) next.padding = "Use a number from 1 to 8";
    if (next.allowedTaxRates === undefined && candidate.allowedTaxRates.some(Number.isNaN)) next.allowedTaxRates = "Tax rates are numbers from 0 to 100, separated by commas";
    setErrors(next);
    if (Object.keys(next).length > 0) {
      toast.error("Some settings need attention");
      return;
    }
    setSaving(true);
    try {
      const saved = await saveSettings(candidate);
      setForm(toForm(saved));
      toast.success("Invoice settings saved");
    } catch (error) {
      setErrors((e) => ({ ...e, ...getFieldErrors(error) })); // the server's own field messages (for example GSTIN and state code)
      toast.error(error?.message ?? "Could not save the settings");
    } finally {
      setSaving(false);
    }
  };

  const onCancel = () => {
    setForm(toForm(settings));
    setErrors({});
  };

  const padding = /^[1-8]$/.test(String(form.numbering.padding).trim()) ? Number(form.numbering.padding) : 4;
  const example = formatBillNumber({ numbering: { ...form.numbering, padding }, financialYear: financialYear(todayBusinessDate()), seq: 1 });

  const field = (key, label, extra = {}) => <Input label={label} value={form[key]} onChange={set(key)} error={errors[key]} {...extra} />;

  return (
    <div id="invoice-settings" className="scroll-mt-20">
      <Card>
        <CardHeader title="Invoice / Business Details" subtitle="Printed on every bill. Bills already finalized keep the details they were finalized with." icon={FileText} />
        <CardBody className="space-y-6">
          <section aria-labelledby="inv-biz" className="space-y-3">
            <h3 id="inv-biz" className="type-card-heading">Business details</h3>
            <p className="type-small">Nothing is filled in for you. Enter your own details. To finalize a GST bill you need at least the business name, address, GSTIN and state code.</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {field("businessName", "Business name", { required: true })}
              {field("businessDescription", "Business description")}
              {field("productsLine", "Materials line (printed under the name)", { wrapperClassName: "sm:col-span-2" })}
              <Textarea label="Address" rows={2} value={form.address} onChange={set("address")} error={errors.address} wrapperClassName="sm:col-span-2" hint="Needed to finalize. The part before the first comma is printed in bold" />
              {field("gstin", "GSTIN", { maxLength: 15, hint: "Needed to finalize a GST bill. Its first 2 digits must match the state code" })}
              {field("pan", "PAN", { maxLength: 10 })}
              {field("phones", "Phone numbers", { hint: "Separate several with commas (up to 4)" })}
              {field("jurisdiction", "Jurisdiction")}
              {field("stateName", "State")}
              {field("stateCode", "State code", { maxLength: 2, inputMode: "numeric", hint: "Decides CGST + SGST or IGST" })}
              {field("proprietorName", "Signature title", { hint: "Printed above the signature space, e.g. Proprietor" })}
            </div>
          </section>

          <section aria-labelledby="inv-bank" className="space-y-3">
            <h3 id="inv-bank" className="type-card-heading">Bank details</h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Input label="Bank name" value={form.bank.bankName} onChange={setBank("bankName")} error={errors.bankName} />
              <Input label="Branch" value={form.bank.branch} onChange={setBank("branch")} error={errors.branch} />
              <Input label="Account number" inputMode="numeric" value={form.bank.accountNumber} onChange={setBank("accountNumber")} error={errors.accountNumber} />
              <Input label="IFSC code" maxLength={11} value={form.bank.ifsc} onChange={setBank("ifsc")} error={errors.ifsc} />
            </div>
          </section>

          <section aria-labelledby="inv-pref" className="space-y-3">
            <h3 id="inv-pref" className="type-card-heading">Invoice preferences</h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Input label="Number prefix" maxLength={10} value={form.numbering.prefix} onChange={setNumbering("prefix")} error={errors.prefix} hint="Letters and digits only" />
              <Select
                label="Separator"
                value={form.numbering.separator}
                onChange={setNumbering("separator")}
                options={[{ value: "/", label: "Slash ( / )" }, { value: "-", label: "Dash ( - )" }, { value: "", label: "None" }]}
                error={errors.separator}
              />
              <Select
                label="Include financial year"
                value={form.numbering.includeFinancialYear ? "yes" : "no"}
                onChange={setNumbering("includeFinancialYear")}
                options={[{ value: "yes", label: "Yes (a new series every April)" }, { value: "no", label: "No" }]}
              />
              <Input label="Running number digits" inputMode="numeric" maxLength={1} value={form.numbering.padding} onChange={setNumbering("padding")} error={errors.padding} />
              <p className="type-small sm:col-span-2">
                The first number of the year looks like: <strong>{example}</strong>. A bill gets its number when it is finalized.
              </p>
              <Select label="Default invoice type" value={form.defaultTaxMode} onChange={set("defaultTaxMode")} options={Object.entries(TAX_MODE_LABELS).map(([value, label]) => ({ value, label }))} error={errors.defaultTaxMode} />
              {field("allowedTaxRates", "Allowed tax rates (%)", { inputMode: "decimal", hint: "Optional, for example 0, 5, 18. Leave empty to allow any rate. No rate is assumed." })}
              {field("units", "Units offered on bills", { wrapperClassName: "sm:col-span-2", hint: "Separate with commas. Any other unit can still be typed on a bill." })}
            </div>
          </section>

          <div className="flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={onCancel} disabled={!dirty || saving}>
              Cancel
            </Button>
            <Button onClick={onSave} loading={saving} disabled={!dirty}>
              Save Settings
            </Button>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
