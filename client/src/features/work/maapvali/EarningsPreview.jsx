import { formatCurrency, formatNumber } from "../../../utils/formatCurrency";

/** Live "what will this entry earn" preview: maaps / 4 x rate per 4 maaps. preview = the derived entry. */
export default function EarningsPreview({ preview }) {
  return (
    <div className="rounded-xl border border-primary/20 bg-primary-soft p-4" aria-live="polite">
      <p className="text-xs font-medium text-fg-muted">Earnings preview</p>
      {preview ? (
        <>
          <p className="mt-1 text-3xl font-bold text-primary">{formatCurrency(preview.earnings)}</p>
          <p className="mt-1 text-sm text-fg-muted">
            {formatNumber(preview.numberOfMaaps)} maaps / 4 x {formatCurrency(preview.ratePerFourMaaps)} per 4 maaps
          </p>
          <p className="type-small mt-3 border-t border-primary/10 pt-2">Every maap is paid. Other days are not affected.</p>
        </>
      ) : (
        <p className="mt-1 text-sm text-fg-muted">Enter the number of maaps (0 or more).</p>
      )}
    </div>
  );
}
