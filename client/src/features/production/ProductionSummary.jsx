import { formatCurrency, formatNumber } from "../../utils/formatCurrency";
import { cn } from "../../utils/cn";

function Tile({ label, value, hint, className }) {
  return (
    <div className={cn("rounded-xl border border-border bg-surface p-3.5 sm:p-4", className)}>
      <p className="text-xs text-fg-muted sm:text-sm">{label}</p>
      <p className="mt-1 truncate text-xl font-bold sm:text-2xl">{value}</p>
      {hint && <p className="type-small mt-0.5">{hint}</p>}
    </div>
  );
}

/**
 * Season-to-date totals. Maaps, physical bricks and payable bricks are always shown separately.
 * summary: { totalMaaps, totalPhysicalBricks, totalPayableBricks, totalEarnings }
 * Payments never change these numbers.
 */
export default function ProductionSummary({ summary, scope }) {
  return (
    <section aria-label="Season to date">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h2 className="type-card-heading">Season to date</h2>
        {scope && <span className="type-small truncate">{scope}</span>}
      </div>
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <Tile label="Maaps" value={formatNumber(summary.totalMaaps)} hint="Recorded so far" />
        <Tile label="Physical bricks" value={formatNumber(summary.totalPhysicalBricks)} hint="275 per maap" />
        <Tile label="Payable bricks" value={formatNumber(summary.totalPayableBricks)} hint="250 per maap (4 maaps = 1,000)" />
        <Tile label="Earnings" value={formatCurrency(summary.totalEarnings)} hint="Maaps / 4 x the team's rate" />
      </div>
      <p className="type-small mt-2">Payments never change maaps, production or payable bricks.</p>
    </section>
  );
}
