import { BarChart3, History, LayoutDashboard, ListChecks, Plus, Truck as TruckIcon } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { Button, Tabs } from "../components/ui";
import PheeraEntryPanel from "../features/trucks/PheeraEntryPanel";
import PheeraHistoryPanel from "../features/trucks/PheeraHistoryPanel";
import TruckListPanel from "../features/trucks/TruckListPanel";
import TruckOverview from "../features/trucks/TruckOverview";
import TruckReportsPanel from "../features/trucks/TruckReportsPanel";
import useTruckTrips from "../features/trucks/useTruckTrips";
import useTruckManagement from "../features/trucks/useTruckManagement";

const TABS = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "trucks", label: "All Trucks", icon: TruckIcon },
  { id: "entry", label: "Daily Entry", icon: ListChecks },
  { id: "history", label: "History", icon: History },
  { id: "reports", label: "Reports", icon: BarChart3 },
];

/**
 * Trucks: status and maintenance (the original page, now the "All Trucks" tab) plus daily Pheera (trip) entry,
 * history / search and reports. The tab is kept in the address (?tab=entry) so links and the back button work.
 * Everything here is separate from labour earnings.
 */
export default function Trucks() {
  const mgmt = useTruckManagement();
  const { loadError } = useTruckTrips();
  const [params, setParams] = useSearchParams();
  const requested = params.get("tab");
  const tab = TABS.some((t) => t.id === requested) ? requested : "overview";
  const setTab = (id) => setParams({ tab: id }, { replace: true });

  return (
    <div className="space-y-4 sm:space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="type-page-heading">Trucks</h1>
          <p className="mt-1 text-sm text-fg-muted">Status, daily trips (Pheera), history and reports. Separate from labour earnings.</p>
        </div>
        <Button leftIcon={Plus} onClick={mgmt.openAdd} className="hidden self-start sm:inline-flex">
          Add Truck
        </Button>
      </div>

      {loadError && (
        <p role="alert" className="rounded-lg bg-danger-soft px-4 py-3 text-sm text-danger">
          Could not load Pheera records: {loadError}
        </p>
      )}

      <div className="sticky top-16 z-20 -mx-4 bg-background px-4 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        <Tabs tabs={TABS} value={tab} onChange={setTab} />
      </div>

      <div role="tabpanel">
        {tab === "overview" && <TruckOverview onOpenTab={setTab} />}
        {tab === "trucks" && (
          <TruckListPanel trucks={mgmt.trucks} summary={mgmt.summary} onUpdateStatus={mgmt.openStatus} onHistory={mgmt.openHistory} onEdit={mgmt.openEdit} />
        )}
        {/* Always mounted (only hidden), so a half-typed entry is not lost when you look at another tab. */}
        <div hidden={tab !== "entry"}>
          <PheeraEntryPanel />
        </div>
        {tab === "history" && <PheeraHistoryPanel />}
        {tab === "reports" && <TruckReportsPanel />}
      </div>

      {/* Phones: floating add button above the bottom nav (All Trucks tab only) */}
      {tab === "trucks" && (
        <button
          type="button"
          aria-label="Add truck"
          onClick={mgmt.openAdd}
          className="fixed bottom-[calc(4.75rem+env(safe-area-inset-bottom))] right-4 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-white shadow-pop transition-transform active:scale-95 sm:hidden"
        >
          <Plus className="h-6 w-6" aria-hidden="true" />
        </button>
      )}

      {mgmt.modals}
    </div>
  );
}
