import { cn } from "../../utils/cn";
import { formatCurrency } from "../../utils/formatCurrency";
import { LABOUR_TYPE_META } from "../../utils/labourTypes";
import LabourTypeBadge from "../labours/LabourTypeBadge";

function Figure({ label, value, strong, danger }) {
  return (
    <div>
      <p className="text-xs text-fg-muted">{label}</p>
      <p className={cn("mt-0.5 text-sm font-semibold sm:text-base", strong && "text-lg", danger && "text-danger")}>{value}</p>
    </div>
  );
}

/**
 * Earned and received in the chosen range, and the outstanding balance season to date, for each labour type.
 * Outstanding does not depend on the range and a payment never resets production, maaps or attendance totals.
 */
export default function SalaryTypeSummary({ summary }) {
  return (
    <section aria-label="Earned, received and outstanding by labour type" className="space-y-3">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3 sm:gap-4">
        {summary.byType.map((t) => {
          const meta = LABOUR_TYPE_META[t.type];
          return (
            <div key={t.type} className="rounded-xl border border-border bg-surface p-4">
              <div className="flex items-center justify-between gap-2">
                <LabourTypeBadge type={t.type} size="md" />
                <span className="type-small">
                  {t.accounts} {t.accounts === 1 ? meta.noun : meta.plural}
                </span>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <Figure label="Earned (range)" value={formatCurrency(t.earned)} />
                <Figure label="Received (range)" value={formatCurrency(t.received)} />
              </div>
              <div className="mt-3 border-t border-border pt-3">
                <Figure label="Outstanding (season to date)" value={formatCurrency(t.outstanding)} strong />
                {t.overpaidCount > 0 && (
                  <p className="mt-1 text-xs font-medium text-danger">
                    Overpaid: {formatCurrency(t.overpaid)} across {t.overpaidCount} {t.overpaidCount === 1 ? "account" : "accounts"}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-3 gap-2 rounded-xl bg-primary-soft p-3 sm:gap-4 sm:p-4">
        <Figure label="Total earned" value={formatCurrency(summary.total.earned)} />
        <Figure label="Total received" value={formatCurrency(summary.total.received)} />
        <Figure label="Total outstanding" value={formatCurrency(summary.total.outstanding)} strong />
      </div>
      <p className="type-small">
        Outstanding is season to date: it does not change with the range and is never reset by a payment.
      </p>
    </section>
  );
}
