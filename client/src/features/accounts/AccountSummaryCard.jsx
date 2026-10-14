import { Banknote } from "lucide-react";
import { Badge, Card, CardBody, CardHeader } from "../../components/ui";
import { cn } from "../../utils/cn";
import { formatCurrency } from "../../utils/formatCurrency";
import { LABOUR_TYPE_META } from "../../utils/labourTypes";

function Row({ label, value, strong }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5">
      <span className={cn("text-sm", strong ? "font-semibold" : "text-fg-muted")}>{label}</span>
      <span className="text-sm font-semibold">{value}</span>
    </div>
  );
}

/**
 * Total earnings, Bayana, salary payments, total received and balance for any labour record.
 * The numbers come from the account calculation layer (worker.earned, worker.totalReceived, worker.balance).
 * Each payment is counted once: Bayana is part of total received, not deducted again.
 */
export default function AccountSummaryCard({ worker, className }) {
  const meta = LABOUR_TYPE_META[worker.labourType];
  const overpaid = worker.balance < 0;

  return (
    <Card className={className}>
      <CardHeader title={meta.noun === "team" ? "Team Account" : "Account"} icon={Banknote} />
      <CardBody>
        <div className="divide-y divide-border">
          <Row label={meta.earningsLabel} value={formatCurrency(worker.earned)} />
          <Row label="Bayana (Booking Advance)" value={formatCurrency(worker.bookingAdvance)} />
          <Row label="Salary Payments" value={formatCurrency(worker.salaryPayments)} />
          {worker.otherPayments > 0 && <Row label="Other Payments" value={formatCurrency(worker.otherPayments)} />}
          <Row label="Total Received" value={formatCurrency(worker.totalReceived)} strong />
        </div>

        <div className={cn("mt-3 flex items-center justify-between gap-3 rounded-lg p-4", overpaid ? "bg-danger-soft" : "bg-primary-soft")}>
          <div>
            <p className="text-xs text-fg-muted">Balance</p>
            {overpaid && (
              <Badge variant="danger" size="sm" className="mt-1">
                Overpaid
              </Badge>
            )}
          </div>
          <p className={cn("text-2xl font-bold", overpaid ? "text-danger" : "text-primary")}>{formatCurrency(worker.balance)}</p>
        </div>
        <p className="type-small mt-3">
          Balance = total earnings - total received. Every payment is counted once. Prototype calculation: final figures are
          calculated by the server.
        </p>
      </CardBody>
    </Card>
  );
}
