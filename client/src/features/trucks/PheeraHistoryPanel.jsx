import { useMemo, useState } from "react";
import { CalendarDays, Inbox } from "lucide-react";
import { Button, Card, CardBody, CardHeader, ConfirmDialog, EmptyState, Table, useToast } from "../../components/ui";
import { ApiError, getErrorMessage } from "../../services/api";
import Pagination from "../../components/common/Pagination";
import { todayBusinessDate } from "../../utils/businessDate";
import { formatDate } from "../../utils/formatDate";
import { formatQuantity, UNITS } from "../../utils/materials";
import { emptyFilters, presetRange } from "./pheeraFilterPresets";
import { dailySummaries, filterPheeras, materialFilterOptions, paginate, sortPheeras, summarizePheeras } from "./pheeraSelectors";
import PheeraFilters from "./PheeraFilters";
import PheeraSummaryTiles from "./PheeraSummaryTiles";
import PheeraTable from "./PheeraTable";
import useTruckTrips from "./useTruckTrips";

const PAGE_SIZE = 20;

const DAILY_COLUMNS = [
  { key: "date", header: "Date", render: (d) => formatDate(d.date) },
  { key: "count", header: "Pheera", align: "right", render: (d) => d.summary.count },
  { key: "bricks", header: "Bricks", align: "right", render: (d) => (d.summary.brickCount ? formatQuantity(d.summary.bricks, UNITS.BRICKS) : "-") },
  { key: "tonnes", header: "Tonnes", align: "right", render: (d) => (d.summary.tonneCount ? formatQuantity(d.summary.tonnes, UNITS.TONNES) : "-") },
];

/**
 * History and global search: filter every Pheera by date, truck, material, destination or text. Newest first.
 * With `lockedTruckId` (the single-truck page) it only shows that truck and starts with all dates.
 */
export default function PheeraHistoryPanel({ lockedTruckId = null }) {
  const toast = useToast();
  const { trucks, rows, destinations, loading, loadError, reload, deletePheera } = useTruckTrips();
  const today = todayBusinessDate();

  const startFilters = () => (lockedTruckId ? { ...emptyFilters(today), ...presetRange("ALL", today) } : emptyFilters(today));
  const [filters, setFilters] = useState(startFilters);
  const [page, setPage] = useState(1);
  const [showDaily, setShowDaily] = useState(false);
  const [deleting, setDeleting] = useState(null);

  const filtered = useMemo(() => sortPheeras(filterPheeras(rows, { ...filters, truckId: lockedTruckId ?? filters.truckId }), "newest"), [rows, filters, lockedTruckId]);
  const summary = useMemo(() => summarizePheeras(filtered), [filtered]);
  const daily = useMemo(() => dailySummaries(filtered), [filtered]);
  const view = paginate(filtered, page, PAGE_SIZE);

  const changeFilters = (next) => {
    setFilters(next);
    setPage(1);
  };

  const confirmDelete = async (reason) => {
    const target = deleting;
    setDeleting(null);
    try {
      await deletePheera(target.id, reason);
      toast.success(`Pheera #${target.pheeraNumber} of ${target.registration} deleted`);
    } catch (error) {
      // the server's own message (for example "locked: in a bill") is shown as it is; a lost connection is not "not deleted"
      const unsure = error instanceof ApiError && error.isConnectionProblem;
      toast.error(unsure ? `${getErrorMessage(error)} Not confirmed: refresh the list to check.` : `Not deleted: ${error instanceof ApiError ? getErrorMessage(error) : (error?.message ?? "Could not delete")}`);
      if (unsure) reload();
    }
  };

  return (
    <div className="space-y-4 sm:space-y-5">
      {loadError && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-danger-soft px-4 py-3 text-sm text-danger">
          <span>Could not load Pheera records: {loadError}</span>
          <Button variant="outline" size="sm" onClick={reload}>
            Try again
          </Button>
        </div>
      )}
      <PheeraFilters filters={filters} onChange={changeFilters} trucks={trucks} destinations={destinations} materials={materialFilterOptions(rows)} today={today} hideTruck={Boolean(lockedTruckId)} />

      <PheeraSummaryTiles summary={summary} heading="Totals for the filters above" />

      <Card>
        <CardHeader
          title="Daily totals"
          subtitle={`${daily.length} ${daily.length === 1 ? "day" : "days"} in this view`}
          icon={CalendarDays}
          action={
            <Button variant="outline" size="sm" onClick={() => setShowDaily((v) => !v)} aria-expanded={showDaily}>
              {showDaily ? "Hide" : "Show"}
            </Button>
          }
        />
        {showDaily && (
          <CardBody>
            <Table columns={DAILY_COLUMNS} data={daily} rowKey="date" empty={<EmptyState title="No days to show" />} />
          </CardBody>
        )}
      </Card>

      {loading ? (
        <Card>
          <CardBody className="text-center text-sm text-fg-muted" aria-live="polite">
            Loading Pheera...
          </CardBody>
        </Card>
      ) : loadError && rows.length === 0 ? null : filtered.length === 0 ? (
        <Card>
          <EmptyState
            icon={Inbox}
            title="No Pheera found"
            description="Try a wider date range or clear the filters."
            action={
              <Button variant="outline" onClick={() => changeFilters(startFilters())}>
                Reset filters
              </Button>
            }
          />
        </Card>
      ) : (
        <Card>
          <CardHeader title="Pheera" subtitle={`${filtered.length} found, newest first`} />
          <CardBody className="space-y-4">
            <PheeraTable rows={view.items} onDelete={setDeleting} showTruck={!lockedTruckId} />
            <Pagination page={view.page} pageCount={view.pageCount} onPageChange={setPage} />
          </CardBody>
        </Card>
      )}

      <ConfirmDialog
        open={Boolean(deleting)}
        title="Delete this Pheera?"
        message={
          deleting
            ? `${deleting.registration}, Pheera #${deleting.pheeraNumber} on ${formatDate(deleting.businessDate)}: ${formatQuantity(deleting.quantity, deleting.unit)} ${deleting.unit} of ${deleting.material} to ${deleting.destination}. Totals and reports will no longer include it. Its number is not reused.`
            : ""
        }
        confirmText="Delete Pheera"
        requireReason
        reasonLabel="Reason for deleting"
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}
