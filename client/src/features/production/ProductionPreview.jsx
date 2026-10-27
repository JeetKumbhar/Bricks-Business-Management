import { cn } from "../../utils/cn";
import { formatCurrency, formatNumber } from "../../utils/formatCurrency";
import { BRICKS_PER_MAAP, PAYABLE_BRICKS_PER_MAAP } from "../../utils/labourTypes";

function Row({ label, value, strong, muted }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <span className={cn("text-sm", muted ? "text-fg-muted" : "text-fg", strong && "font-semibold")}>{label}</span>
      <span className={cn("text-sm font-semibold", strong && "text-base")}>{value}</span>
    </div>
  );
}

/**
 * Read-only calculation shown while filling the correction form. Every number comes from `entry`
 * (the derived production entry from the one calculation module); nothing here does its own maths.
 */
export default function ProductionPreview({ entry, rate }) {
  if (!entry) {
    return (
      <div className="rounded-xl border border-primary/20 bg-primary-soft p-4" aria-live="polite">
        <p className="text-xs font-medium text-fg-muted">Calculation</p>
        <p className="mt-1 text-sm text-fg-muted">Enter the maaps (0 or more) to see the calculation.</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-primary/20 bg-primary-soft p-4" aria-live="polite">
      <p className="text-xs font-medium text-fg-muted">Calculation for this entry</p>
      <div className="mt-1 divide-y divide-primary/10">
        <Row label="Maaps entered" value={formatNumber(entry.newMaaps)} />
        <Row label={`Physical bricks (${BRICKS_PER_MAAP} per maap)`} value={formatNumber(entry.newPhysicalBricks)} muted />
        <Row label={`Payable bricks (${PAYABLE_BRICKS_PER_MAAP} per maap)`} value={formatNumber(entry.newPayableBricks)} />
        <Row label="Team rate per 4 maaps / 1,000 payable bricks" value={formatCurrency(rate)} muted />
      </div>
      <div className="mt-2 flex items-center justify-between gap-4 border-t border-primary/20 pt-3">
        <span className="text-sm font-semibold">Earnings from this entry</span>
        <span className="text-2xl font-bold text-primary">{formatCurrency(entry.newEarnings)}</span>
      </div>
      <p className="type-small mt-3 border-t border-primary/10 pt-2">Every maap is paid. Other days are not affected.</p>
    </div>
  );
}
