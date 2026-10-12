import { X } from "lucide-react";
import { Card, CardBody, SearchInput, Tabs } from "../../components/ui";

/** Search (name / mobile / labour ID), status filter (All / Active / Inactive) and type filter. */
export default function LabourFilters({ search, onSearchChange, status, onStatusChange, type, onTypeChange, counts }) {
  const statusTabs = [
    { id: "ALL", label: "All", count: counts.total },
    { id: "ACTIVE", label: "Active", count: counts.active },
    { id: "INACTIVE", label: "Inactive", count: counts.inactive },
  ];

  const typeTabs = [
    { id: "ALL", label: "All types" },
    { id: "BIGARI", label: "Bigari", count: counts.bigari },
    { id: "MAAPVALI", label: "Maapvali", count: counts.maapvali },
    { id: "PATLAVALE", label: "Patlavale", count: counts.patlavale },
  ];

  return (
    <Card>
      <CardBody className="space-y-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <SearchInput
            className="w-full lg:max-w-md"
            value={search}
            onChange={onSearchChange}
            placeholder="Search by name, ID or mobile number..."
          />
          <Tabs variant="pills" fullWidth className="lg:w-auto" tabs={statusTabs} value={status} onChange={onStatusChange} />
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <span className="type-small shrink-0">Type</span>
          <Tabs variant="pills" fullWidth className="sm:w-auto" tabs={typeTabs} value={type} onChange={onTypeChange} />
        </div>

        {status === "NEW" && (
          <button
            type="button"
            onClick={() => onStatusChange("ALL")}
            className="inline-flex items-center gap-1.5 rounded-full bg-primary-soft px-3 py-1.5 text-xs font-medium text-primary"
          >
            Joined this month
            <X className="h-3.5 w-3.5" aria-label="Clear filter" />
          </button>
        )}
      </CardBody>
    </Card>
  );
}
