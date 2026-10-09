import { Pencil, Phone, UserCheck, UserX } from "lucide-react";
import { Badge, Button, Card, CardBody, Dropdown } from "../../../components/ui";
import { cn } from "../../../utils/cn";
import { formatCurrency } from "../../../utils/formatCurrency";
import { formatDate } from "../../../utils/formatDate";
import { LABOUR_STATUS, LABOUR_STATUS_META } from "../../../utils/labourStatus";

const initials = (name) =>
  name
    .split(" ")
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

/** Top card: who this is, current balance, and quick actions (call / edit / status). */
export default function ProfileHeader({ labour, onEdit, onToggleStatus }) {
  const meta = LABOUR_STATUS_META[labour.status];
  const isActive = labour.status === LABOUR_STATUS.ACTIVE;
  const overpaid = labour.balance < 0;

  return (
    <Card>
      <CardBody className="space-y-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3 sm:gap-4">
            <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-primary-soft text-lg font-semibold text-primary sm:h-16 sm:w-16 sm:text-xl">
              {initials(labour.name)}
            </span>
            <div className="min-w-0">
              <h1 className="truncate text-xl font-bold tracking-tight sm:text-2xl">{labour.name}</h1>
              <p className="type-small">
                {labour.id} - {labour.village}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Badge variant={meta.variant}>{meta.label}</Badge>
                <span className="type-small">Joined {formatDate(labour.joiningDate)}</span>
              </div>
            </div>
          </div>

          <div
            className={cn(
              "flex items-center justify-between gap-6 rounded-lg px-4 py-3 lg:min-w-64",
              overpaid ? "bg-danger-soft" : "bg-background"
            )}
          >
            <span className="text-sm text-fg-muted">{overpaid ? "Overpaid" : "Balance salary"}</span>
            <span className={cn("text-xl font-bold", overpaid && "text-danger")}>{formatCurrency(labour.balance)}</span>
          </div>
        </div>

        <div className="flex items-center gap-2 border-t border-border pt-4">
          <a
            href={`tel:${labour.mobile}`}
            className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-lg border border-border bg-surface px-4 text-sm font-semibold text-fg transition-colors hover:bg-background sm:h-10 sm:flex-none"
          >
            <Phone className="h-4 w-4" aria-hidden="true" />
            Call
          </a>
          <Button variant="outline" leftIcon={Pencil} onClick={onEdit} className="flex-1 sm:flex-none">
            Edit
          </Button>
          <Dropdown
            ariaLabel="More actions"
            triggerClassName="h-11 w-11 border border-border sm:h-10 sm:w-10"
            items={[
              {
                label: isActive ? "Mark as inactive" : "Mark as active",
                icon: isActive ? UserX : UserCheck,
                variant: isActive ? "danger" : undefined,
                onClick: onToggleStatus,
              },
            ]}
          />
        </div>
      </CardBody>
    </Card>
  );
}
