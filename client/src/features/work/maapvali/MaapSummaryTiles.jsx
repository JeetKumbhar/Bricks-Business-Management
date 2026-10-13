import { formatCurrency, formatNumber } from "../../../utils/formatCurrency";
import { cn } from "../../../utils/cn";

function Tile({ label, summary, className }) {
  return (
    <div className={cn("rounded-xl border border-border bg-surface p-3.5 sm:p-4", className)}>
      <p className="text-xs text-fg-muted sm:text-sm">{label}</p>
      <p className="mt-1 truncate text-xl font-bold sm:text-2xl">{formatCurrency(summary.earnings)}</p>
      <p className="type-small mt-0.5">{formatNumber(summary.maaps)} maaps</p>
    </div>
  );
}

/** Earnings and maaps: today, last 7 days, and the list currently shown. */
export default function MaapSummaryTiles({ today, week, shown }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4">
      <Tile label="Today" summary={today} />
      <Tile label="Last 7 days" summary={week} />
      <Tile label="In this list" summary={shown} className="col-span-2 sm:col-span-1" />
    </div>
  );
}
