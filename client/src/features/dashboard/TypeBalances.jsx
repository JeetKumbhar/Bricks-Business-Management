import { Scale } from "lucide-react";
import { Card, CardBody, CardHeader } from "../../components/ui";
import { cn } from "../../utils/cn";
import { formatCurrency } from "../../utils/formatCurrency";
import { LABOUR_TYPE_META } from "../../utils/labourTypes";
import LabourTypeBadge from "../labours/LabourTypeBadge";

/**
 * Earnings, money received and outstanding balance for each labour type.
 * outstanding = what is still owed (balances above zero). Overpaid accounts are shown separately in red.
 */
export default function TypeBalances({ money, className }) {
  return (
    <Card className={className}>
      <CardHeader title="Balances by Type" subtitle="Season to date" icon={Scale} />
      <CardBody>
        <ul className="divide-y divide-border">
          {money.byType.map((t) => {
            const meta = LABOUR_TYPE_META[t.type];
            return (
              <li key={t.type} className="py-3 first:pt-0">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <LabourTypeBadge type={t.type} />
                    <span className="type-small">
                      {t.accounts} {t.accounts === 1 ? "account" : "accounts"}
                    </span>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-fg-muted">Outstanding</p>
                    <p className="text-base font-bold">{formatCurrency(t.outstanding)}</p>
                  </div>
                </div>
                <dl className="mt-2 grid grid-cols-2 gap-x-4 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <dt className="text-fg-muted">{meta.earningsLabel}</dt>
                    <dd className="font-medium">{formatCurrency(t.earned)}</dd>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <dt className="text-fg-muted">Received</dt>
                    <dd className="font-medium">{formatCurrency(t.received)}</dd>
                  </div>
                </dl>
                {t.overpaidCount > 0 && (
                  <p className="mt-1.5 text-xs font-medium text-danger">
                    Overpaid: {formatCurrency(t.overpaid)} across {t.overpaidCount} {t.overpaidCount === 1 ? "account" : "accounts"}
                  </p>
                )}
              </li>
            );
          })}
        </ul>

        <div className={cn("mt-3 flex items-center justify-between gap-3 rounded-lg p-3", "bg-primary-soft")}>
          <span className="text-sm font-semibold">Total outstanding</span>
          <span className="text-lg font-bold text-primary">{formatCurrency(money.outstanding)}</span>
        </div>
        <p className="type-small mt-2">
          Payments reduce what is owed. They never change attendance, maap entries or production.
        </p>
      </CardBody>
    </Card>
  );
}
