import { CheckCheck } from "lucide-react";
import { Button, SearchInput, Tabs } from "../../components/ui";

/** Search, "Mark All Present", and an "All / Not marked" filter. */
export default function AttendanceToolbar({ search, onSearchChange, filter, onFilterChange, totals, onMarkAllPresent, shownCount }) {
  const tabs = [
    { id: "ALL", label: "All", count: totals.all },
    { id: "UNMARKED", label: "Not marked", count: totals.unmarked },
  ];

  return (
    <div className="space-y-3">
      <SearchInput value={search} onChange={onSearchChange} placeholder="Search labour by name, ID or mobile..." />
      <Button variant="success" leftIcon={CheckCheck} fullWidth onClick={onMarkAllPresent} disabled={shownCount === 0}>
        {search.trim() ? `Mark ${shownCount} Shown as Present` : "Mark All Present"}
      </Button>
      <Tabs variant="pills" tabs={tabs} value={filter} onChange={onFilterChange} />
    </div>
  );
}
