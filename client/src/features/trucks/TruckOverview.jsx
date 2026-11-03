import { useMemo } from "react";
import { AlertTriangle, CheckCircle2, History, ListChecks, Truck as TruckIcon, XCircle } from "lucide-react";
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, StatCard } from "../../components/ui";
import { useTruckStore } from "../../context/TruckContext";
import { todayBusinessDate } from "../../utils/businessDate";
import { formatDate } from "../../utils/formatDate";
import { formatQuantity, UNITS } from "../../utils/materials";
import { TRUCK_STATUS, TRUCK_STATUS_META } from "../../utils/truckStatus";
import { filterPheeras, groupPheeras, sortPheeras, summarizePheeras } from "./pheeraSelectors";
import PheeraSummaryTiles from "./PheeraSummaryTiles";
import PheeraTable from "./PheeraTable";
import { summarizeTrucks, trucksNeedingAttention } from "./truckSummary";
import useTruckTrips from "./useTruckTrips";

/** Today at a glance: truck status, today's Pheera, which trucks ran, who needs attention, and the latest trips. */
export default function TruckOverview({ onOpenTab }) {
  const { trucks, rows } = useTruckTrips();
  const { maintenance } = useTruckStore();
  const today = todayBusinessDate();

  const summary = useMemo(() => summarizeTrucks(trucks), [trucks]);
  const todayRows = useMemo(() => filterPheeras(rows, { date: today }), [rows, today]);
  const todaySummary = summarizePheeras(todayRows);
  const byTruck = useMemo(() => groupPheeras(sortPheeras(todayRows, "oldest"), (r) => r.truckId).sort((a, b) => b.rows.length - a.rows.length), [todayRows]);
  const idle = useMemo(() => trucks.filter((t) => t.status === TRUCK_STATUS.WORKING && !todayRows.some((r) => r.truckId === t.id)), [trucks, todayRows]);
  const attention = useMemo(() => trucksNeedingAttention(trucks, maintenance), [trucks, maintenance]);
  const recent = useMemo(() => sortPheeras(rows, "newest").slice(0, 8), [rows]);
  const truckById = Object.fromEntries(trucks.map((t) => [t.id, t]));

  return (
    <div className="space-y-4 sm:space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard title="Total trucks" value={summary.total} icon={TruckIcon} color="blue" variant="soft" onCardClick={() => onOpenTab("trucks")} />
        <StatCard title="Working" value={summary.working} icon={CheckCircle2} color="green" variant="soft" onCardClick={() => onOpenTab("trucks")} />
        <StatCard title="Stopped" value={summary.stopped} icon={XCircle} color="red" variant="soft" onCardClick={() => onOpenTab("trucks")} />
        <StatCard title="Maintenance" value={summary.maintenance} icon={AlertTriangle} color="yellow" variant="soft" onCardClick={() => onOpenTab("trucks")} />
      </div>

      <PheeraSummaryTiles summary={todaySummary} heading={`Today's Pheera - ${formatDate(today)}`} />

      <div className="flex flex-wrap gap-2">
        <Button leftIcon={ListChecks} onClick={() => onOpenTab("entry")}>
          Record today&apos;s Pheera
        </Button>
        <Button variant="outline" leftIcon={History} onClick={() => onOpenTab("history")}>
          View history
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Today by truck" subtitle="Trucks that have made trips today" />
          <CardBody className="space-y-3">
            {byTruck.length === 0 ? (
              <p className="type-small">No Pheera recorded yet today.</p>
            ) : (
              <ul className="divide-y divide-border">
                {byTruck.map((g) => {
                  const t = truckById[g.key];
                  const s = g.summary;
                  return (
                    <li key={g.key} className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{t?.truckNumber ?? g.rows[0].registration}</p>
                        <p className="type-small">{s.count} Pheera</p>
                      </div>
                      <p className="shrink-0 text-right text-sm font-semibold">
                        {[s.brickCount ? `${formatQuantity(s.bricks, UNITS.BRICKS)} bricks` : null, s.tonneCount ? `${formatQuantity(s.tonnes, UNITS.TONNES)} tonnes` : null].filter(Boolean).join(" + ")}
                      </p>
                    </li>
                  );
                })}
              </ul>
            )}
            {idle.length > 0 && (
              <div className="border-t border-border pt-3">
                <p className="mb-1.5 text-xs font-medium text-fg-muted">Working trucks with no Pheera yet today</p>
                <div className="flex flex-wrap gap-1.5">
                  {idle.map((t) => (
                    <Badge key={t.id} variant="neutral">
                      {t.truckNumber}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Needs attention" subtitle="Trucks that are not working" />
          <CardBody>
            {attention.length === 0 ? (
              <p className="type-small">All trucks are working.</p>
            ) : (
              <ul className="divide-y divide-border">
                {attention.map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{a.truckNumber}</p>
                      <p className="type-small truncate">
                        {a.reason} - since {formatDate(a.since)}
                      </p>
                    </div>
                    <Badge variant={TRUCK_STATUS_META[a.status].variant}>{TRUCK_STATUS_META[a.status].label}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader title="Recent Pheera" subtitle="The latest trips across all trucks" />
        <CardBody>
          {recent.length === 0 ? <EmptyState title="No Pheera recorded yet" description="Use Daily Entry to record the first one." /> : <PheeraTable rows={recent} />}
        </CardBody>
      </Card>
    </div>
  );
}
