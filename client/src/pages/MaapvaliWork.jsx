import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Plus } from "lucide-react";
import { Button, Card, ConfirmDialog, useToast } from "../components/ui";
import MaapEntryList from "../features/work/maapvali/MaapEntryList";
import MaapEntryModal from "../features/work/maapvali/MaapEntryModal";
import MaapFilters from "../features/work/maapvali/MaapFilters";
import { filterMaapEntries } from "../features/work/maapvali/maapSelectors";
import MaapSummaryTiles from "../features/work/maapvali/MaapSummaryTiles";
import useMaapvaliWork from "../features/work/maapvali/useMaapvaliWork";
import { formatCurrency } from "../utils/formatCurrency";
import { addDaysISO, formatDate, toISODate } from "../utils/formatDate";
import { summarizeMaapWork } from "../utils/workCalculations";

/**
 * Maapvali work: record maaps transported per worker per day.
 * earnings = maaps x the worker's rate per maap. Adding work never changes the payment ledger.
 */
export default function MaapvaliWork() {
  const toast = useToast();
  const { maapvali, activeWorkers, entries, getDayTotal, addMaapEntry, updateMaapEntry, deleteMaapEntry } = useMaapvaliWork();

  const today = toISODate();
  const [search, setSearch] = useState("");
  const [period, setPeriod] = useState("ALL");

  // null = closed. { entry: null } = add, { entry } = edit. key / defaultDate support "Save & Add Another".
  const [modal, setModal] = useState(null);
  const [deleting, setDeleting] = useState(null);

  const filtered = useMemo(() => filterMaapEntries(entries, { search, period, today }), [entries, search, period, today]);
  const todaySummary = useMemo(() => summarizeMaapWork(entries.filter((e) => e.date === today)), [entries, today]);
  const weekSummary = useMemo(() => {
    const start = addDaysISO(today, -6);
    return summarizeMaapWork(entries.filter((e) => e.date >= start));
  }, [entries, today]);
  const shownSummary = useMemo(() => summarizeMaapWork(filtered), [filtered]);

  const hasFilters = search.trim() !== "" || period !== "ALL";
  const canAdd = activeWorkers.length > 0;

  const openAdd = () => setModal({ entry: null, key: 0, defaultDate: today });

  const handleSubmit = (values, intent) => {
    if (modal.entry) {
      updateMaapEntry(
        modal.entry.id,
        { date: values.date, numberOfMaaps: values.maaps, note: values.note },
        values.reason
      );
      toast.success("Work entry corrected");
      setModal(null);
      return;
    }

    const entry = addMaapEntry({
      labourId: values.labourId,
      date: values.date,
      numberOfMaaps: values.maaps,
      note: values.note,
    });
    const name = maapvali.find((w) => w.id === entry.labourId)?.name ?? entry.labourId;
    toast.success(`${name}: ${entry.numberOfMaaps} maaps = ${formatCurrency(entry.earnings)}`);

    if (intent === "another") {
      // keep the sheet open for the next worker, on the same date
      setModal((m) => ({ ...m, key: m.key + 1, defaultDate: values.date }));
    } else {
      setModal(null);
    }
  };

  const handleDelete = (reason) => {
    deleteMaapEntry(deleting.id, reason);
    toast.success("Work entry deleted");
    setDeleting(null);
  };

  return (
    <div className="space-y-4 sm:space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="type-page-heading">Maapvali Work</h1>
          <p className="mt-1 text-sm text-fg-muted">Record the maaps each worker transported. Earnings = maaps x rate per maap.</p>
        </div>
        <Button leftIcon={Plus} onClick={openAdd} disabled={!canAdd} className="hidden self-start sm:inline-flex">
          Add Work Entry
        </Button>
      </div>

      {!canAdd && (
        <Card>
          <p className="p-4 text-sm text-fg-muted">
            There is no active Maapvali worker. Add one in{" "}
            <Link to="/labours" className="font-medium text-primary">
              Labour Management
            </Link>{" "}
            (choose the Maapvali type) to record work.
          </p>
        </Card>
      )}

      <MaapSummaryTiles today={todaySummary} week={weekSummary} shown={shownSummary} />

      <MaapFilters search={search} onSearchChange={setSearch} period={period} onPeriodChange={setPeriod} />

      <Card className="p-4 sm:p-5">
        <MaapEntryList
          key={`${period}|${search}`}
          entries={filtered}
          onEdit={(entry) => setModal({ entry, key: 0, defaultDate: entry.date })}
          onDelete={setDeleting}
          emptyTitle={hasFilters ? "No work entries found" : "No work entries yet"}
          emptyDescription={hasFilters ? "Try a different search or period." : "Add the first entry with the button below."}
          emptyAction={
            hasFilters ? (
              <Button
                variant="outline"
                onClick={() => {
                  setSearch("");
                  setPeriod("ALL");
                }}
              >
                Clear filters
              </Button>
            ) : undefined
          }
        />
      </Card>

      {/* Phones: floating add button above the bottom nav */}
      {canAdd && (
        <button
          type="button"
          aria-label="Add work entry"
          onClick={openAdd}
          className="fixed bottom-[calc(4.75rem+env(safe-area-inset-bottom))] right-4 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-white shadow-pop transition-transform active:scale-95 sm:hidden"
        >
          <Plus className="h-6 w-6" aria-hidden="true" />
        </button>
      )}

      <MaapEntryModal
        open={Boolean(modal)}
        entry={modal?.entry ?? null}
        workers={activeWorkers}
        allWorkers={maapvali}
        defaultDate={modal?.defaultDate ?? today}
        formKey={modal?.key ?? 0}
        getDayTotal={getDayTotal}
        onClose={() => setModal(null)}
        onSubmit={handleSubmit}
      />

      <ConfirmDialog
        open={Boolean(deleting)}
        variant="danger"
        title="Delete work entry?"
        message={
          deleting
            ? `${deleting.numberOfMaaps} maaps (${formatCurrency(deleting.earnings)}) for ${deleting.workerName} on ${formatDate(deleting.date)} will be removed from the worker's earnings. Payments are not affected. This is recorded in the audit log.`
            : ""
        }
        confirmText="Delete"
        requireReason
        reasonLabel="Reason for deleting"
        onConfirm={handleDelete}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}
