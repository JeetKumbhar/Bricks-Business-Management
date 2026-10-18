import { Link } from "react-router-dom";
import { History, Pencil, RefreshCw, Truck as TruckIcon, UserRound } from "lucide-react";
import { Badge, Button, Card, Dropdown } from "../../components/ui";
import { formatDate } from "../../utils/formatDate";
import { STOP_REASON_LABELS, TRUCK_STATUS, TRUCK_STATUS_META } from "../../utils/truckStatus";

const statusLine = (t) => {
  const since = formatDate(t.statusSince);
  if (t.status === TRUCK_STATUS.STOPPED) {
    const reason = STOP_REASON_LABELS[t.stopReason] ?? "Stopped";
    return `Stopped since ${since}: ${reason}${t.statusNote ? ` (${t.statusNote})` : ""}`;
  }
  if (t.status === TRUCK_STATUS.MAINTENANCE) return `In maintenance since ${since}${t.statusNote ? `: ${t.statusNote}` : ""}`;
  return `Working since ${since}`;
};

/** One truck: number, model, driver, current status (with the stop reason), and its actions. */
export default function TruckCard({ truck, onUpdateStatus, onDetails, onEdit }) {
  const meta = TRUCK_STATUS_META[truck.status];

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary">
            <TruckIcon className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-lg font-bold">{truck.truckNumber}</p>
            <p className="type-small truncate">
              {truck.model || "Model not set"}
              {truck.capacity ? ` - ${truck.capacity} ton` : ""}
            </p>
          </div>
        </div>
        <Badge variant={meta.variant}>{meta.label}</Badge>
      </div>

      <p className="text-sm text-fg-muted">{statusLine(truck)}</p>

      <p className="flex items-center gap-2 text-sm">
        <UserRound className="h-4 w-4 shrink-0 text-fg-muted" aria-hidden="true" />
        {truck.driverId ? (
          <Link to={`/labours/${truck.driverId}`} className="font-medium text-primary">
            {truck.driverName}
          </Link>
        ) : (
          <span className="text-fg-muted">No driver assigned</span>
        )}
      </p>

      <div className="mt-auto flex items-center gap-2 border-t border-border pt-3">
        <Button leftIcon={RefreshCw} onClick={() => onUpdateStatus(truck)} className="flex-1">
          Update Status
        </Button>
        <Button variant="outline" leftIcon={History} onClick={() => onDetails(truck)}>
          Details
        </Button>
        <Dropdown
          ariaLabel={`More actions for ${truck.truckNumber}`}
          triggerClassName="h-11 w-11 border border-border sm:h-10 sm:w-10"
          items={[{ label: "Edit truck", icon: Pencil, onClick: () => onEdit(truck) }]}
        />
      </div>
    </Card>
  );
}
