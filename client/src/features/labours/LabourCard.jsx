import { Eye, Pencil, Phone, UserCheck, UserX } from "lucide-react";
import { Badge, Button, Dropdown } from "../../components/ui";
import { attendanceDays, calculateBalance } from "../../utils/calculations";
import { cn } from "../../utils/cn";
import { formatCurrency } from "../../utils/formatCurrency";
import { LABOUR_STATUS, LABOUR_STATUS_META } from "../../utils/labourStatus";

const initials = (name) =>
  name
    .split(" ")
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

/** Phone layout for one labour (replaces a table row below the md breakpoint). */
export default function LabourCard({ labour, onView, onEdit, onToggleStatus }) {
  const meta = LABOUR_STATUS_META[labour.status];
  const balance = calculateBalance(labour);
  const isActive = labour.status === LABOUR_STATUS.ACTIVE;

  return (
    <li className="rounded-xl border border-border bg-surface p-4">
      <div className="flex items-start gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary-soft text-sm font-semibold text-primary">
          {initials(labour.name)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{labour.name}</p>
          <p className="type-small">
            {labour.id} - {labour.village}
          </p>
        </div>
        <Badge variant={meta.variant}>{meta.label}</Badge>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
        <div>
          <dt className="type-small">Mobile</dt>
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
          <dt className="type-small">Daily Rate</dt>
          <dd className="font-medium">{formatCurrency(labour.dailyRate)}</dd>
        </div>
        <div>
          <dt className="type-small">Present Days</dt>
          <dd className="font-medium">
            {attendanceDays(labour)}{" "}
            <span className="type-small font-normal">
              ({labour.presentDays} full, {labour.halfDays} half)
            </span>
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
