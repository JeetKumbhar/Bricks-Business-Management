import { formatCurrency, formatNumber } from "../../../utils/formatCurrency";
import { calculateMaapEarnings, estimateBricks } from "../../../utils/workCalculations";

/** Live "maaps x rate = earnings" preview. The brick estimate is information only. */
export default function EarningsPreview({ maaps, rate }) {
  const ready = maaps !== null && rate > 0;

  return (
    <div className="rounded-xl border border-primary/20 bg-primary-soft p-4" aria-live="polite">
      <p className="text-xs font-medium text-fg-muted">Earnings preview</p>
      {ready ? (
        <>
          <p className="mt-1 text-3xl font-bold text-primary">{formatCurrency(calculateMaapEarnings(maaps, rate))}</p>
          <p className="mt-1 text-sm text-fg-muted">
            {formatNumber(maaps)} maaps x {formatCurrency(rate)}
          </p>
          <p className="type-small mt-3 border-t border-primary/10 pt-2">
            About {formatNumber(estimateBricks(maaps))} bricks ({formatNumber(maaps)} x 275). For information only: it is not
            used to calculate salary.
          </p>
        </>
      ) : (
        <p className="mt-1 text-sm text-fg-muted">Choose a worker and enter the number of maaps.</p>
      )}
    </div>
  );
}
