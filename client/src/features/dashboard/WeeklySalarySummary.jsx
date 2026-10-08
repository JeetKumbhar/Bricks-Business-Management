import { AlertTriangle, Banknote } from "lucide-react";
import { Card, CardBody, CardHeader } from "../../components/ui";
import { percentage } from "../../utils/calculations";
import { formatCurrency } from "../../utils/formatCurrency";
import ViewAllButton from "./ViewAllButton";

function Row({ label, value, valueClass }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <span className="text-sm text-fg-muted">{label}</span>
      <span className={`text-sm font-semibold ${valueClass ?? ""}`}>{value}</span>
    </div>
  );
}

/**
 * Rolling last-7-days view (salary has no fixed week - see BUSINESS_RULES).
 * paid = every payment type, because all of them count as "received".
 */
export default function WeeklySalarySummary({ earned, paid, pendingBalance, overpaidLabours = 0, className }) {
  const paidPercent = Math.min(100, percentage(paid, earned));

  return (
    <Card className={className}>
      <CardHeader
        title="Weekly Salary Summary"
        subtitle="Last 7 days"
        icon={Banknote}
        action={<ViewAllButton to="/salary" label="View" />}
      />
      <CardBody>
        <div className="divide-y divide-border">
          <Row label="Earned" value={formatCurrency(earned)} />
          <Row label="Paid" value={formatCurrency(paid)} valueClass="text-success" />
        </div>

        <div className="mt-2">
          <div className="mb-1.5 flex justify-between text-xs text-fg-muted">
            <span>Paid vs earned</span>
            <span>{paidPercent}%</span>
          </div>
          <div
            role="progressbar"
            aria-valuenow={paidPercent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Share of weekly earnings already paid"
            className="h-2 overflow-hidden rounded-full bg-background"
          >
            <div className="h-full rounded-full bg-success" style={{ width: `${paidPercent}%` }} />
          </div>
        </div>

        <div className="mt-4 rounded-lg bg-primary-soft p-3">
          <p className="text-xs text-fg-muted">Total pending balance</p>
          <p className="mt-0.5 text-xl font-bold text-primary">{formatCurrency(pendingBalance)}</p>
        </div>

        {overpaidLabours > 0 && (
          <p className="mt-3 flex items-center gap-2 rounded-lg bg-danger-soft px-3 py-2 text-sm font-medium text-red-600">
            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
            {overpaidLabours} {overpaidLabours === 1 ? "labour has" : "labours have"} a negative balance
          </p>
        )}
      </CardBody>
    </Card>
  );
}
