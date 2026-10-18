import { cn } from "../../utils/cn";
import { formatCurrency } from "../../utils/formatCurrency";
import LabourTypeBadge from "../labours/LabourTypeBadge";

export const money = (value, extra) => <span className={cn(value < 0 && "text-danger", extra)}>{formatCurrency(value)}</span>;

export const nameCell = (r) => (
  <div>
    <p className="font-medium">{r.name}</p>
    <p className="type-small">{r.id}</p>
  </div>
);

export const cardHeader = (r) => (
  <div className="flex items-start justify-between gap-3">
    <div className="min-w-0">
      <p className="truncate font-semibold">{r.name}</p>
      <p className="mt-0.5 flex items-center gap-2 type-small">
        {r.id}
        <LabourTypeBadge type={r.labourType} />
      </p>
    </div>
    <div className="shrink-0 text-right">
      <p className="text-xs text-fg-muted">Balance (season)</p>
      <p className="text-base font-bold">{money(r.season.balance)}</p>
    </div>
  </div>
);

/** A small label / value grid used inside the phone cards. */
export const factGrid = (facts) => (
  <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 rounded-lg bg-background p-3 text-sm">
    {facts.map(([label, value]) => (
      <div key={label}>
        <dt className="type-small">{label}</dt>
        <dd className="font-medium">{value}</dd>
      </div>
    ))}
  </dl>
);
