import { formatCurrency } from "../../utils/formatCurrency";

function Tile({ label, value, className }) {
  return (
    <div className={`rounded-xl border border-border bg-surface p-3.5 sm:p-4 ${className ?? ""}`}>
      <p className="text-xs text-fg-muted sm:text-sm">{label}</p>
      <p className="mt-1 truncate text-xl font-bold sm:text-2xl">{formatCurrency(value)}</p>
    </div>
  );
}

/** Today / last 7 days / total of the list currently shown. */
export default function PaymentSummaryTiles({ today, last7Days, shown }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4">
      <Tile label="Paid today" value={today} />
      <Tile label="Last 7 days" value={last7Days} />
      <Tile label="In this list" value={shown} className="col-span-2 sm:col-span-1" />
    </div>
  );
}
