import { Banknote } from "lucide-react";
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
 * Last 7 days across all three types: what was earned (from each type's own records) and what was paid.
 * Rolling window, not a fixed salary week (see docs/BUSINESS_RULES.md).
 */
export default function WeeklySalarySummary({ earnings, className }) {
  const paidPercent = Math.min(100, percentage(earnings.paid, earnings.total));

  return (
    <Card className={className}>
      <CardHeader
        title="Last 7 Days"
        subtitle="Earned and paid, all types"
        icon={Banknote}
        action={<ViewAllButton to="/payments" label="View" />}
      />
      <CardBody>
        <div className="divide-y divide-border">
          <Row label="Bigari (attendance)" value={formatCurrency(earnings.bigari)} />
          <Row label="Maapvali (maaps)" value={formatCurrency(earnings.maapvali)} />
          <Row label="Patlavale (payable bricks)" value={formatCurrency(earnings.patlavale)} />
          <Row label="Total earned" value={formatCurrency(earnings.total)} />
          <Row label="Paid" value={formatCurrency(earnings.paid)} valueClass="text-success" />
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
            aria-label="Share of the last 7 days' earnings already paid"
            className="h-2 overflow-hidden rounded-full bg-background"
          >
            <div className="h-full rounded-full bg-success" style={{ width: `${paidPercent}%` }} />
          </div>
        </div>
      </CardBody>
    </Card>
  );
}
