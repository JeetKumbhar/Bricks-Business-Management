import { Truck } from "lucide-react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { Badge, Card, CardBody, CardHeader } from "../../components/ui";
import { formatDate } from "../../utils/formatDate";
import { chartColors } from "./chartColors";
import ViewAllButton from "./ViewAllButton";

const statusBadge = {
  STOPPED: { label: "Stopped", variant: "danger" },
  MAINTENANCE: { label: "Maintenance", variant: "warning" },
};

/** Donut chart of truck statuses + trucks that need attention. */
export default function TruckStatus({ trucks, attention = [], className }) {
  const slices = [
    { name: "Working", value: trucks.working, color: chartColors.working },
    { name: "Stopped", value: trucks.stopped, color: chartColors.stopped },
    { name: "Maintenance", value: trucks.maintenance, color: chartColors.maintenance },
  ];

  return (
    <Card className={className}>
      <CardHeader title="Truck Status" icon={Truck} action={<ViewAllButton to="/trucks" />} />
      <CardBody className="space-y-5">
        <div className="flex flex-col items-center gap-4 sm:flex-row sm:justify-around lg:flex-col xl:flex-row">
          <div className="relative h-44 w-44 shrink-0">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={slices} dataKey="value" nameKey="name" innerRadius={54} outerRadius={80} paddingAngle={2} stroke="none">
                  {slices.map((s) => (
                    <Cell key={s.name} fill={s.color} />
                  ))}
                </Pie>
                <Tooltip contentStyle={{ borderRadius: 8, borderColor: chartColors.grid, fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-2xl font-bold leading-none">{trucks.total}</span>
              <span className="type-small mt-1">Total Trucks</span>
            </div>
          </div>

          <ul className="w-full max-w-48 space-y-2">
            {slices.map((s) => (
              <li key={s.name} className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: s.color }} aria-hidden="true" />
                  {s.name}
                </span>
                <span className="font-semibold">{s.value}</span>
              </li>
            ))}
          </ul>
        </div>

        {attention.length > 0 && (
          <div>
            <p className="type-small mb-2 font-medium">Needs attention</p>
            <ul className="divide-y divide-border rounded-lg border border-border">
              {attention.map((t) => {
                const badge = statusBadge[t.status];
                return (
                  <li key={t.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{t.truckNumber}</p>
                      <p className="type-small truncate">
                        {t.reason} - since {formatDate(t.since)}
                      </p>
                    </div>
                    <Badge variant={badge.variant} size="sm">
                      {badge.label}
                    </Badge>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
