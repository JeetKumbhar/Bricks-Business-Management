import { useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, BarChart3, History, ListChecks, Pencil, RefreshCw, Truck as TruckIcon, UserRound } from "lucide-react";
import { Badge, Button, Card, CardBody, EmptyState } from "../components/ui";
import PheeraHistoryPanel from "../features/trucks/PheeraHistoryPanel";
import PheeraSummaryTiles from "../features/trucks/PheeraSummaryTiles";
import { filterPheeras, summarizePheeras } from "../features/trucks/pheeraSelectors";
import useTruckManagement from "../features/trucks/useTruckManagement";
import useTruckTrips from "../features/trucks/useTruckTrips";
import { formatDate } from "../utils/formatDate";
import { STOP_REASON_LABELS, TRUCK_STATUS, TRUCK_STATUS_META } from "../utils/truckStatus";

/** One truck: its details, status, and the complete history of its Pheera (trips). */
export default function TruckDetail() {
  const { id } = useParams();
  const mgmt = useTruckManagement();
  const { rows } = useTruckTrips();
  const truck = mgmt.trucks.find((t) => t.id === id) ?? null;

  const total = useMemo(() => summarizePheeras(filterPheeras(rows, { truckId: id })), [rows, id]);

  if (!truck && (mgmt.loading || mgmt.status === "error")) {
    return (
      <Card>
        <EmptyState
          icon={TruckIcon}
          title={mgmt.loading ? "Loading truck..." : "Could not load the truck"}
          description={mgmt.loading ? undefined : mgmt.loadError}
          action={mgmt.loading ? undefined : <Button onClick={mgmt.reload}>Try again</Button>}
        />
      </Card>
    );
  }

  if (!truck) {
    return (
      <Card>
        <EmptyState
          icon={TruckIcon}
          title="Truck not found"
          description="This truck does not exist (it may have been removed)."
          action={
            <Link to="/trucks?tab=trucks">
              <Button>Back to trucks</Button>
            </Link>
          }
        />
      </Card>
    );
  }

  const meta = TRUCK_STATUS_META[truck.status];
  const since = formatDate(truck.statusSince);
  const statusLine =
    truck.status === TRUCK_STATUS.STOPPED
      ? `Stopped since ${since}: ${STOP_REASON_LABELS[truck.stopReason] ?? "reason not set"}${truck.statusNote ? ` (${truck.statusNote})` : ""}`
      : truck.status === TRUCK_STATUS.MAINTENANCE
        ? `In maintenance since ${since}${truck.statusNote ? `: ${truck.statusNote}` : ""}`
        : `Working since ${since}`;

  return (
    <div className="space-y-4 sm:space-y-5">
      <Link to="/trucks?tab=trucks" className="inline-flex items-center gap-1.5 py-1 text-sm font-medium text-primary">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        All trucks
      </Link>

      <Card>
        <CardBody className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary">
                <TruckIcon className="h-6 w-6" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <h1 className="type-page-heading truncate">{truck.truckNumber}</h1>
                <p className="type-small truncate">
                  {[truck.nickname, truck.model, truck.capacity ? `${truck.capacity} ton` : null].filter(Boolean).join(" - ") || "No model set"}
                </p>
              </div>
            </div>
            <Badge variant={meta.variant} className="self-start">
              {meta.label}
            </Badge>
          </div>

          <p className="text-sm text-fg-muted">{statusLine}</p>
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

          <div className="flex flex-wrap gap-2 border-t border-border pt-3">
            <Link to={`/trucks?tab=entry&truck=${truck.id}`}>
              <Button leftIcon={ListChecks}>Record Pheera</Button>
            </Link>
            <Button variant="outline" leftIcon={RefreshCw} onClick={() => mgmt.openStatus(truck)}>
              Update Status
            </Button>
            <Button variant="outline" leftIcon={History} onClick={() => mgmt.openHistory(truck)}>
              Status history
            </Button>
            <Link to={`/reports?report=trucks&truck=${truck.id}`}>
              <Button variant="outline" leftIcon={BarChart3}>
                Truck report
              </Button>
            </Link>
            <Button variant="outline" leftIcon={Pencil} onClick={() => mgmt.openEdit(truck)}>
              Edit
            </Button>
          </div>
        </CardBody>
      </Card>

      <PheeraSummaryTiles summary={total} heading="All time totals for this truck" />

      <PheeraHistoryPanel lockedTruckId={truck.id} />

      {mgmt.modals}
    </div>
  );
}
