import { Eye, Pencil, Phone, UserCheck, UserX } from "lucide-react";
import { Badge, Button, Dropdown } from "../../components/ui";
import { calculateBalance } from "../../utils/calculations";
import { cn } from "../../utils/cn";
import { formatCurrency } from "../../utils/formatCurrency";
import { formatRate } from "../../utils/formatRate";
import { LABOUR_STATUS, LABOUR_STATUS_META } from "../../utils/labourStatus";
import LabourAvatar from "./LabourAvatar";
import { getWorkSummary } from "./labourSummaries";
import LabourTypeBadge from "./LabourTypeBadge";

/** Phone layout for one worker or team (replaces a table row below the md breakpoint). */
export default function LabourCard({ labour, onView, onEdit, onToggleStatus }) {
  const meta = LABOUR_STATUS_META[labour.status];
  const balance = calculateBalance(labour);
  const isActive = labour.status === LABOUR_STATUS.ACTIVE;
  const work = getWorkSummary(labour);

  return (
    <li className="rounded-xl border border-border bg-surface p-4">
      <div className="flex items-start gap-3">
        <LabourAvatar worker={labour} className="h-11 w-11 text-sm" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{labour.name}</p>
          <p className="type-small">
            {labour.id} - {labour.village}
          </p>
          <div className="mt-1.5">
            <LabourTypeBadge type={labour.labourType} />
          </div>
        </div>
        <Badge variant={meta.variant}>{meta.label}</Badge>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
        <div>
          <dt className="type-small">{labour.labourType === "PATLAVALE" ? "Contact Mobile" : "Mobile"}</dt>
          <dd>
            <a
              href={`tel:${labour.mobile}`}
              className="inline-flex items-center gap-1.5 py-0.5 font-medium text-primary"
              aria-label={`Call ${labour.name}`}
            >
              <Phone className="h-3.5 w-3.5" aria-hidden="true" />
              {labour.mobile}
            </a>
          </dd>
        </div>
        <div>
          <dt className="type-small">Rate</dt>
          <dd className="font-medium">{formatRate(labour)}</dd>
        </div>
        <div>
          <dt className="type-small">Work</dt>
          <dd className="font-medium">
            {work.primary}
            <span className="type-small block font-normal">{work.secondary}</span>
          </dd>
        </div>
        <div>
          <dt className="type-small">Balance</dt>
          <dd className={cn("font-semibold", balance < 0 && "text-danger")}>
            {formatCurrency(balance)}
            {balance < 0 && <span className="ml-1 text-xs font-medium">(overpaid)</span>}
          </dd>
        </div>
      </dl>

      <div className="mt-4 flex items-center gap-2 border-t border-border pt-3">
        <Button variant="outline" leftIcon={Eye} onClick={() => onView(labour)} className="flex-1">
          View
        </Button>
        <Button variant="outline" leftIcon={Pencil} onClick={() => onEdit(labour)} className="flex-1">
          Edit
        </Button>
        <Dropdown
          ariaLabel={`More actions for ${labour.name}`}
          triggerClassName="h-11 w-11 border border-border"
          items={[
            {
              label: isActive ? "Mark as inactive" : "Mark as active",
              icon: isActive ? UserX : UserCheck,
              variant: isActive ? "danger" : undefined,
              onClick: () => onToggleStatus(labour),
            },
          ]}
        />
      </div>
    </li>
  );
}
