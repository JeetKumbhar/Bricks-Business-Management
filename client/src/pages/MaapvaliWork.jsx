import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Save } from "lucide-react";
import { Button, Card, ConfirmDialog, EmptyState, SearchInput, Tabs, useToast } from "../components/ui";
import DailySummaryTiles from "../features/work/shared/DailySummaryTiles";
import WorkDateBar from "../features/work/shared/WorkDateBar";
import MaapDailyRow from "../features/work/maapvali/MaapDailyRow";
import MaapEntryList from "../features/work/maapvali/MaapEntryList";
import MaapEntryModal from "../features/work/maapvali/MaapEntryModal";
import MaapFilters from "../features/work/maapvali/MaapFilters";
import {
  buildMaapDailyRows,
  filterMaapEntries,
  getDailyRoster,
  summarizeMaapDay,
} from "../features/work/maapvali/maapSelectors";
import MaapSummaryTiles from "../features/work/maapvali/MaapSummaryTiles";
import useMaapvaliWork from "../features/work/maapvali/useMaapvaliWork";
import { formatCurrency, formatNumber } from "../utils/formatCurrency";
import { addDaysISO, formatDate, toISODate } from "../utils/formatDate";
import { summarizeMaapWork } from "../utils/workCalculations";

/**
 * Maapvali daily work sheet: pick a day, type each worker's maaps, save everyone at once.
 * Earnings = maaps / 4 x the worker's rate per 4 maaps. Every maap is paid; there is no carry-forward.
 * Saving work never changes the payment ledger. Below the sheet, History lets the owner correct or delete one entry.
 */
export default function MaapvaliWork() {
  const toast = useToast();
  const { maapvali, activeWorkers, entries, previewEntry, saveMaapDay, updateMaapEntry, deleteMaapEntry } = useMaapvaliWork();

  const today = toISODate();
  const [date, setDate] = useState(today);
  const [draft, setDraft] = useState({}); // { [labourId]: { maaps?, note? } } typed since the last save
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("ALL"); // ALL | NOT_ENTERED | ENTERED
  const [pendingDate, setPendingDate] = useState(null);
  const [confirmSave, setConfirmSave] = useState(false);

  // History section
  const [histSearch, setHistSearch] = useState("");
  const [period, setPeriod] = useState("ALL");
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);

  const roster = useMemo(() => getDailyRoster(activeWorkers, date), [activeWorkers, date]);
  const rows = useMemo(() => buildMaapDailyRows({ roster, entries, date, draft }), [roster, entries, date, draft]);
  const day = useMemo(() => summarizeMaapDay(rows), [rows]);

  const changed = useMemo(() => rows.filter((r) => r.dirty), [rows]);
  const invalid = useMemo(() => rows.filter((r) => r.error), [rows]);
  const dirty = changed.length > 0;
  const isPast = date < today;

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter === "NOT_ENTERED" && r.entered) return false;
      if (filter === "ENTERED" && !r.entered) return false;
      return !q || r.worker.name.toLowerCase().includes(q) || r.worker.id.toLowerCase().includes(q) || r.worker.mobile?.includes(q);
    });
  }, [rows, search, filter]);

  useEffect(() => {
    if (!dirty) return undefined;
    const warn = (e) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const setMaaps = useCallback((id, value) => setDraft((d) => ({ ...d, [id]: { ...d[id], maaps: value } })), []);
  const setNote = useCallback((id, value) => setDraft((d) => ({ ...d, [id]: { ...d[id], note: value } })), []);

  const applyDate = (next) => {
    setDate(next);
    setDraft({});
    setSearch("");
    setFilter("ALL");
  };
  const requestDateChange = (next) => {
    if (!next || next > today || next === date) return;
    if (dirty) setPendingDate(next);
    else applyDate(next);
  };

  const doSave = (reason) => {
    const count = saveMaapDay(
      date,
      changed.map((r) => ({ labourId: r.worker.id, maaps: Number(r.text), note: r.note.trim() })),
      isPast ? reason : undefined
    );
    setDraft({});
    setConfirmSave(false);
    toast.success(`${count} ${count === 1 ? "entry" : "entries"} saved for ${formatDate(date)}`);
  };

  const requestSave = () => {
    if (invalid.length > 0) {
      toast.error(`Fix ${invalid.length} ${invalid.length === 1 ? "row" : "rows"} before saving`);
      return;
    }
    if (isPast || day.notEntered > 0) setConfirmSave(true);
    else doSave();
  };

    const saveMessage = [
    `${changed.length} ${changed.length === 1 ? "worker" : "workers"} will be saved for ${formatDate(date)}.`,
    day.notEntered > 0 ? `${day.notEntered} ${day.notEntered === 1 ? "worker has" : "workers have"} no entry for this day.` : "",
  ]
    .filter(Boolean)
    .join(" ");

  const saveButton = (extraClass) => (
    <Button leftIcon={Save} onClick={requestSave} disabled={!dirty} className={extraClass}>
      Save Daily Entries
    </Button>
  );

  // ---- history ----
  const filteredHistory = useMemo(
    () => filterMaapEntries(entries, { search: histSearch, period, today }),
    [entries, histSearch, period, today]
  );
  const todaySummary = useMemo(() => summarizeMaapWork(entries.filter((e) => e.date === today)), [entries, today]);
  const weekSummary = useMemo(() => {
    const start = addDaysISO(today, -6);
    return summarizeMaapWork(entries.filter((e) => e.date >= start));
  }, [entries, today]);
  const shownSummary = useMemo(() => summarizeMaapWork(filteredHistory), [filteredHistory]);
  const hasHistFilters = histSearch.trim() !== "" || period !== "ALL";

  return (
    <div className="space-y-4 sm:space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="type-page-heading">Maapvali Work</h1>
          <p className="mt-1 text-sm text-fg-muted">
            Enter each worker's maaps for the day, then save once. The rate is per 4 maaps; every maap is paid (maaps / 4 x rate).
          </p>
        </div>
        <div className="hidden lg:block">{saveButton()}</div>
      </div>

      {activeWorkers.length === 0 ? (
        <Card>
          <p className="p-4 text-sm text-fg-muted">
            There is no active Maapvali worker. Add one in{" "}
            <Link to="/labours" className="font-medium text-primary">
              Labour Management
            </Link>{" "}
            (choose the Maapvali type) to record work.
          </p>
        </Card>
      ) : (
        <>
          <WorkDateBar date={date} today={today} onChange={requestDateChange} label="Maapvali work date" />

          <DailySummaryTiles
            tiles={[
              { label: "Maaps entered", value: formatNumber(day.maaps), sub: formatDate(date) },
              { label: "Estimated earnings", value: formatCurrency(day.earnings), sub: "maaps / 4 x rate" },
              { label: "Workers with entries", value: `${day.entered} / ${day.total}`, sub: `${day.notEntered} not entered` },
            ]}
          />

          <div className="space-y-3">
            <SearchInput value={search} onChange={setSearch} placeholder="Search worker by name, ID or mobile..." />
            <Tabs
              variant="pills"
              tabs={[
                { id: "ALL", label: "All", count: day.total },
                { id: "NOT_ENTERED", label: "Not entered", count: day.notEntered },
                { id: "ENTERED", label: "Entered", count: day.entered },
              ]}
              value={filter}
              onChange={setFilter}
            />
          </div>

          {rows.length === 0 ? (
            <EmptyState title="No worker on this day" description="No active Maapvali worker had joined by this date." />
          ) : visible.length === 0 ? (
            <EmptyState title="No worker found" description="Try a different search or filter." />
          ) : (
            <ul className="space-y-2.5">
              {visible.map((row) => (
                <MaapDailyRow key={row.worker.id} row={row} onMaapsChange={setMaaps} onNoteChange={setNote} />
              ))}
            </ul>
          )}
        </>
      )}

      {/* Extra space so the fixed save bar never covers the last row */}
      <div className="h-20 lg:hidden" aria-hidden="true" />
      <div className="fixed inset-x-0 bottom-[calc(3.9rem+env(safe-area-inset-bottom))] z-30 flex items-center gap-3 border-t border-border bg-surface px-4 py-3 shadow-pop lg:hidden">
        <p className="min-w-0 flex-1 text-sm">
          {dirty ? (
            <span className="font-medium text-fg">
              {changed.length} unsaved {changed.length === 1 ? "change" : "changes"}
            </span>
          ) : (
            <span className="text-fg-muted">All changes saved</span>
          )}
        </p>
        {saveButton("shrink-0")}
      </div>

      <section className="space-y-3 pt-4">
        <div>
          <h2 className="type-section-heading text-lg font-semibold">Work history</h2>
          <p className="text-sm text-fg-muted">Correct or delete a single saved entry. Totals below are labelled by period.</p>
        </div>
        <MaapSummaryTiles today={todaySummary} week={weekSummary} shown={shownSummary} />
        <MaapFilters search={histSearch} onSearchChange={setHistSearch} period={period} onPeriodChange={setPeriod} />
        <Card className="p-4 sm:p-5">
          <MaapEntryList
            key={`${period}|${histSearch}`}
            entries={filteredHistory}
            onEdit={setEditing}
            onDelete={setDeleting}
            emptyTitle={hasHistFilters ? "No work entries found" : "No work entries yet"}
            emptyDescription={hasHistFilters ? "Try a different search or period." : "Saved daily entries appear here."}
            emptyAction={
              hasHistFilters ? (
                <Button
                  variant="outline"
                  onClick={() => {
                    setHistSearch("");
                    setPeriod("ALL");
                  }}
                >
                  Clear filters
                </Button>
              ) : undefined
            }
          />
        </Card>
      </section>

      <MaapEntryModal
        open={Boolean(editing)}
        entry={editing}
        allWorkers={maapvali}
        previewEntry={previewEntry}
        onClose={() => setEditing(null)}
        onSubmit={(values) => {
          updateMaapEntry(editing.id, { date: values.date, numberOfMaaps: values.maaps, note: values.note }, values.reason);
          toast.success("Work entry corrected");
          setEditing(null);
        }}
      />

      <ConfirmDialog
        open={confirmSave}
        variant="primary"
        title={isPast ? "Save changes to a previous day?" : "Some workers have no entry"}
        message={saveMessage}
        confirmText="Save"
        cancelText="Keep editing"
        requireReason={isPast}
        reasonLabel="Reason for changing a previous day"
        onConfirm={doSave}
        onCancel={() => setConfirmSave(false)}
      />

      <ConfirmDialog
        open={Boolean(pendingDate)}
        variant="danger"
        title="Discard unsaved changes?"
        message={`You have ${changed.length} unsaved ${changed.length === 1 ? "change" : "changes"} for ${formatDate(date)}. Switching day will discard them.`}
        confirmText="Discard and switch"
        cancelText="Stay here"
        onConfirm={() => {
          applyDate(pendingDate);
          setPendingDate(null);
        }}
        onCancel={() => setPendingDate(null)}
      />

      <ConfirmDialog
        open={Boolean(deleting)}
        variant="danger"
        title="Delete work entry?"
        message={
          deleting
            ? `${deleting.numberOfMaaps} maaps (${formatCurrency(deleting.earnings)}) for ${deleting.workerName} on ${formatDate(deleting.date)} will be removed. Other days are not affected. Payments are not affected. This is recorded in the audit log.`
            : ""
        }
        confirmText="Delete"
        requireReason
        reasonLabel="Reason for deleting"
        onConfirm={(reason) => {
          deleteMaapEntry(deleting.id, reason);
          toast.success("Work entry deleted");
          setDeleting(null);
        }}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}
