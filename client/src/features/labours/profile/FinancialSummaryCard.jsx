import { Banknote } from "lucide-react";
import { Badge, Card, CardBody, CardHeader } from "../../../components/ui";
import { cn } from "../../../utils/cn";
import { formatCurrency } from "../../../utils/formatCurrency";

function Row({ label, value, strong, valueClass }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5">
      <span className={cn("text-sm", strong ? "font-semibold" : "text-fg-muted")}>{label}</span>
      <span className={cn("text-sm font-semibold", valueClass)}>{value}</span>
    </div>
  );
}

/** Earned Salary, Booking Advance, Salary Payments, Total Received, Balance Salary. */
export default function FinancialSummaryCard({ labour, className }) {
  const overpaid = labour.balance < 0;

  return (
    <Card className={className}>
      <CardHeader title="Financial Summary" icon={Banknote} />
      <CardBody>
        <div className="divide-y divide-border">
          <Row label="Earned Salary" value={formatCurrency(labour.earned)} />
          <Row label="Booking Advance" value={formatCurrency(labour.bookingAdvance)} />
          <Row label="Salary Payments" value={formatCurrency(labour.salaryPayments)} />
          {labour.otherPayments > 0 && <Row label="Other Payments" value={formatCurrency(labour.otherPayments)} />}
          <Row label="Total Received" value={formatCurrency(labour.totalReceived)} strong />
        </div>

        <div
          className={cn(
            "mt-3 flex items-center justify-between gap-3 rounded-lg p-4",
            overpaid ? "bg-danger-soft" : "bg-primary-soft"
          )}
        >
          <div>
            <p className="text-xs text-fg-muted">Balance Salary</p>
            {overpaid && (
              <Badge variant="danger" size="sm" className="mt-1">
                Overpaid
              </Badge>
            )}
          </div>
          <p className={cn("text-2xl font-bold", overpaid ? "text-danger" : "text-primary")}>
            {formatCurrency(labour.balance)}
          </p>
        </div>
        <p className="type-small mt-3">Balance = earned salary - total received</p>
      </CardBody>
    </Card>
  );
}
