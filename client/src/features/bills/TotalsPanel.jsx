import { Card, CardBody, CardHeader } from "../../components/ui";
import { amountInWords } from "../../utils/amountInWords";
import { formatRupees } from "../../utils/money";
import { percentText } from "./billCalculations";
import { taxRows } from "./invoiceFormat";

/** Live tax summary and invoice total. Everything here is calculated from the items, nothing is typed. */
export default function TotalsPanel({ totals, taxMode }) {
  const rows = taxRows(totals);
  return (
    <Card>
      <CardHeader title="Tax Summary" subtitle="Updates as you type" />
      <CardBody className="space-y-2">
        <dl className="space-y-2 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-fg-muted">Total taxable amount</dt>
            <dd className="font-medium">{formatRupees(totals.taxablePaise)}</dd>
          </div>
          {rows.map((r) => (
            <div key={r.key} className="flex justify-between gap-3">
              <dt className="text-fg-muted">{r.label}</dt>
              <dd className="font-medium">{formatRupees(r.paise)}</dd>
            </div>
          ))}
          {taxMode !== "GST" && <p className="type-small">No GST is added to this bill.</p>}
          {totals.taxPending && <p className="type-small" role="status">GST is not added yet: the customer's state code (and yours, in Settings) decide CGST + SGST or IGST.</p>}
        </dl>
        {totals.slabs.length > 1 && (
          <p className="type-small">Taxed at different rates: {totals.slabs.map((s) => `${percentText(s.rateBp)}% on ${formatRupees(s.taxablePaise)}`).join(", ")}.</p>
        )}
        <div className="flex items-baseline justify-between gap-3 border-t border-border pt-3">
          <dt className="font-semibold">Grand Total</dt>
          <dd className="text-2xl font-bold" aria-live="polite">{formatRupees(totals.grandPaise)}</dd>
        </div>
        <p className="text-sm text-fg-muted">{amountInWords(totals.grandPaise)}</p>
      </CardBody>
    </Card>
  );
}
