import { CalendarCheck, Clock, Truck, UserPlus, Wallet } from "lucide-react";
import { Card, CardBody, CardHeader, EmptyState } from "../../components/ui";
import { formatRelativeTime } from "../../utils/formatDate";
import { cn } from "../../utils/cn";

const activityMeta = {
  attendance: { icon: CalendarCheck, style: "bg-success-soft text-success" },
  payment: { icon: Wallet, style: "bg-primary-soft text-primary" },
  truck: { icon: Truck, style: "bg-danger-soft text-danger" },
  labour: { icon: UserPlus, style: "bg-violet-100 text-violet-600" },
};

export default function RecentActivities({ activities, className }) {
  return (
    <Card className={className}>
      <CardHeader title="Recent Activities" icon={Clock} />
      <CardBody className="pt-2 sm:pt-2">
        {activities.length === 0 ? (
          <EmptyState title="No recent activity" />
        ) : (
          <ul className="divide-y divide-border">
            {activities.map((a) => {
              const meta = activityMeta[a.type] ?? activityMeta.attendance;
              const Icon = meta.icon;
              return (
                <li key={a.id} className="flex items-start gap-3 py-3">
                  <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-full", meta.style)}>
                    <Icon className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{a.title}</p>
                    <p className="type-small truncate">{a.detail}</p>
                  </div>
                  <time dateTime={a.time} className="type-small shrink-0 whitespace-nowrap">
                    {formatRelativeTime(a.time)}
                  </time>
                </li>
              );
            })}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
