import { cn } from "../../utils/cn";
import { formatCurrency, formatNumber } from "../../utils/formatCurrency";
import { PAYABLE_BRICKS_PER_GROUP, PHYSICAL_BRICKS_PER_GROUP } from "../../utils/labourTypes";

function Row({ label, value, strong, muted }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <span className={cn("text-sm", muted ? "text-fg-muted" : "text-fg", strong && "font-semibold")}>{label}</span>
      <span className={cn("text-sm font-semibold", strong && "text-base")}>{value}</span>
    </div>
  );
}

/**
 * Read-only calculation shown while filling the form. Every number comes from `result`
 * (the one calculation module); nothing here does its own maths.
 * result: { entry, season, laterEntriesChanged } | null
 */
export default function ProductionPreview({ result, rate, isEdit }) {
  if (!result?.entry) {
    return (
      <div className="rounded-xl border border-primary/20 bg-primary-soft p-4" aria-live="polite">
        <p className="text-xs font-medium text-fg-muted">Calculation</p>
        <p className="mt-1 text-sm text-fg-muted">Choose a team and enter the new physical bricks to see the calculation.</p>
      </div>
    );
  }

  const { entry, season, laterEntriesChanged } = result;

  return (
    <div className="space-y-3" aria-live="polite">
      <div className="rounded-xl border border-primary/20 bg-primary-soft p-4">
        <p className="text-xs font-medium text-fg-muted">Calculation for this entry</p>
        <div className="mt-1 divide-y divide-primary/10">
          <Row label="Previous carry-forward bricks" value={formatNumber(entry.previousCarryBricks)} muted />
          <Row label="New physical bricks" value={formatNumber(entry.newPhysicalBricks)} muted />
          <Row label="Total physical bricks available" value={formatNumber(entry.physicalAvailable)} />
          <Row label={`Completed groups of ${formatNumber(PHYSICAL_BRICKS_PER_GROUP)}`} value={formatNumber(entry.completedGroups)} />
          <Row
            label={`New payable bricks (${formatNumber(PAYABLE_BRICKS_PER_GROUP)} per group)`}
            value={formatNumber(entry.newPayableBricks)}
          />
          <Row label="Remaining carry-forward bricks" value={formatNumber(entry.carryForwardBricks)} />
          <Row label="Team rate per 1,000 payable bricks" value={formatCurrency(rate)} muted />
        </div>
        <div className="mt-2 flex items-center justify-between gap-4 border-t border-primary/20 pt-3">
          <span className="text-sm font-semibold">Earnings from this entry</span>
          <span className="text-2xl font-bold text-primary">{formatCurrency(entry.newEarnings)}</span>
        </div>
        {entry.completedGroups === 0 && (
          <p className="type-small mt-3 border-t border-primary/10 pt-2">
            Not enough for a full group of 1,100 yet, so nothing is payable. All {formatNumber(entry.carryForwardBricks)} bricks carry forward.
          </p>
        )}
      </div>

      <div className="rounded-xl border border-border bg-background p-4">
        <p className="text-xs font-medium text-fg-muted">Season to date after this entry</p>
        <div className="mt-1 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <span className="text-fg-muted">Physical bricks</span>
          <span className="text-right font-semibold">{formatNumber(season.totalPhysicalBricks)}</span>
          <span className="text-fg-muted">Payable bricks</span>
          <span className="text-right font-semibold">{formatNumber(season.totalPayableBricks)}</span>
          <span className="text-fg-muted">Earnings</span>
          <span className="text-right font-semibold">{formatCurrency(season.totalEarnings)}</span>
          <span className="text-fg-muted">Carry-forward</span>
          <span className="text-right font-semibold">{formatNumber(season.carryForwardBricks)}</span>
        </div>
      </div>

      {laterEntriesChanged > 0 && (
        <p className="rounded-lg bg-warning-soft px-3 py-2.5 text-sm text-amber-900">
          {isEdit ? "This change" : "Saving on this date"} also recalculates {laterEntriesChanged} later{" "}
          {laterEntriesChanged === 1 ? "entry" : "entries"}, because their carry-forward changes.
        </p>
      )}
    </div>
  );
}
