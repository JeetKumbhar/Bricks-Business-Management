import { UserCheck, UserPlus, Users, UserX } from "lucide-react";
import { StatCard } from "../../components/ui";

/** Four soft summary cards. Clicking a link applies the matching list filter. */
export default function LabourSummaryCards({ counts, onSelectFilter }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
      <StatCard variant="soft" color="blue" icon={Users} title="Total Labour" value={counts.total}
        actionLabel="View All" onAction={() => onSelectFilter("ALL")} />
      <StatCard variant="soft" color="green" icon={UserCheck} title="Active Labour" value={counts.active}
        actionLabel="View Active" onAction={() => onSelectFilter("ACTIVE")} />
      <StatCard variant="soft" color="red" icon={UserX} title="Inactive Labour" value={counts.inactive}
        actionLabel="View Inactive" onAction={() => onSelectFilter("INACTIVE")} />
      <StatCard variant="soft" color="yellow" icon={UserPlus} title="New This Month" value={counts.newThisMonth}
        actionLabel="View New" onAction={() => onSelectFilter("NEW")} />
    </div>
  );
}
