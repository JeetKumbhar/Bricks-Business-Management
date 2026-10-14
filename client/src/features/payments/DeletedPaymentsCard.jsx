import { useState } from "react";
import { ChevronDown, Trash2 } from "lucide-react";
import { Card, CardBody } from "../../components/ui";
import { cn } from "../../utils/cn";
import { formatCurrency } from "../../utils/formatCurrency";
import { formatDate } from "../../utils/formatDate";
import { PAYMENT_TYPE_META } from "../../utils/paymentTypes";
import LabourTypeBadge from "../labours/LabourTypeBadge";

/**
 * Deleted payments are never erased: they stay on record with the reason, and every balance ignores them.
 * Collapsed by default; shown only when there is something deleted.
 */
export default function DeletedPaymentsCard({ deleted }) {
  const [open, setOpen] = useState(false);
  if (deleted.length === 0) return null;

  return (
    <Card>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left sm:px-5"
      >
        <span className="flex items-center gap-2.5">
          <Trash2 className="h-5 w-5 text-fg-muted" aria-hidden="true" />
          <span>
            <span className="type-card-heading block">Deleted payments ({deleted.length})</span>
            <span className="type-small">Kept for the record. Not counted in any balance.</span>
          </span>
        </span>
        <ChevronDown className={cn("h-5 w-5 shrink-0 text-fg-muted transition-transform", open && "rotate-180")} aria-hidden="true" />
      </button>

      {open && (
        <CardBody className="border-t border-border pt-2 sm:pt-2">
          <ul className="divide-y divide-border">
            {deleted.map((p) => (
              <li key={p.id} className="space-y-1 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{p.labourName}</p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 type-small">
                      {p.labourId} - {formatDate(p.date)} - {PAYMENT_TYPE_META[p.type].label}
                      {p.labourType && <LabourTypeBadge type={p.labourType} />}
                    </p>
                  </div>
                  <p className="shrink-0 text-base font-bold text-fg-muted line-through">{formatCurrency(p.amount)}</p>
                </div>
                <p className="type-small">
                  Deleted{p.deletedAt ? ` on ${formatDate(p.deletedAt)}` : ""}: {p.deletedReason}
                </p>
              </li>
            ))}
          </ul>
        </CardBody>
      )}
    </Card>
  );
}
