import { X } from "lucide-react";
import { Card, CardBody, SearchInput, Tabs } from "../../components/ui";

/** Search (name / mobile / labour ID) + status filter (All / Active / Inactive). */
export default function LabourFilters({ search, onSearchChange, status, onStatusChange, counts }) {
  const tabs = [
    { id: "ALL", label: "All", count: counts.total },
    { id: "ACTIVE", label: "Active", count: counts.active },
    { id: "INACTIVE", label: "Inactive", count: counts.inactive },
  ];

  return (
    <Card>
      <CardBody className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <SearchInput
          className="w-full lg:max-w-md"
          value={search}
          onChange={onSearchChange}
          placeholder="Search by name, ID or mobile number..."
        />

        <div className="flex flex-wrap items-center gap-2">
          <Tabs variant="pills" fullWidth className="lg:w-auto" tabs={tabs} value={status} onChange={onStatusChange} />
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
        </div>
      </CardBody>
    </Card>
  );
}
