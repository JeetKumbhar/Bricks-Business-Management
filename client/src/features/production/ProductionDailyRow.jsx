import { memo } from "react";
import { fieldBase, fieldState } from "../../components/ui/fieldStyles";
import { cn } from "../../utils/cn";
import { formatCurrency, formatNumber } from "../../utils/formatCurrency";

const Fact = ({ label, value, strong }) => (
  <div className="min-w-0">
    <p className="text-[11px] leading-none text-fg-muted">{label}</p>
    <p className={cn("mt-1 truncate text-sm", strong ? "font-bold" : "font-medium")}>{value}</p>
  </div>
);

/**
 * One Patlavale team for the selected day: Name | maaps input | rate per 4 maaps, physical bricks, payable bricks, earnings.
 * Maaps, physical bricks and payable bricks are always shown separately.
 */
function ProductionDailyRow({ row, onMaapsChange, onNoteChange }) {
  const { owner: team, text, note, error, calc, rate, dirty, saved } = row;

  return (
    <li
      className={cn(
        "space-y-3 rounded-xl border border-l-4 border-border bg-surface p-3 md:p-4",
        error ? "border-l-danger" : dirty ? "border-l-amber-400" : calc ? "border-l-success" : "border-l-border"
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-base font-semibold">{team.name}</p>
          <p className="type-small">
            {team.id} - {team.village}
          </p>
        </div>
        <div className="w-28 shrink-0 sm:w-32">
          <input
            type="number"
            inputMode="numeric"
            min="0"
            step="1"
            value={text}
            placeholder="Maaps"
            aria-label={`Maaps today for ${team.name}`}
            aria-invalid={Boolean(error)}
            onChange={(e) => onMaapsChange(team.id, e.target.value)}
            onWheel={(e) => e.currentTarget.blur()}
            className={cn(fieldBase, fieldState(error), "h-12 text-center text-lg font-semibold md:h-10")}
          />
        </div>
      </div>

      {error && <p className="text-xs text-danger">{error}</p>}

      <div className="grid grid-cols-2 gap-x-3 gap-y-2.5 sm:grid-cols-4">
        <Fact label="Rate / 4 maaps" value={formatCurrency(rate)} />
        <Fact label="Physical bricks" value={calc ? formatNumber(calc.physicalBricks) : "-"} />
        <Fact label="Payable bricks" value={calc ? formatNumber(calc.payableBricks) : "-"} />
        <Fact label="Earnings" value={calc ? formatCurrency(calc.earnings) : "-"} strong />
      </div>

      <input
        type="text"
        value={note}
        maxLength={200}
        placeholder="Note (optional)"
        aria-label={`Note for ${team.name}`}
        onChange={(e) => onNoteChange(team.id, e.target.value)}
        className={cn(fieldBase, fieldState(false), "h-9 text-sm")}
      />
      {saved && !dirty && <p className="type-small">Saved</p>}
    </li>
  );
}

export default memo(ProductionDailyRow);
