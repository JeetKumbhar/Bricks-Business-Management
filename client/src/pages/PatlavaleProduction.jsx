import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Save } from "lucide-react";
import { Button, Card, ConfirmDialog, EmptyState, SearchInput, Tabs, useToast } from "../components/ui";
import ProductionDailyRow from "../features/production/ProductionDailyRow";
import ProductionEntryModal from "../features/production/ProductionEntryModal";
import ProductionFilters from "../features/production/ProductionFilters";
import ProductionLedger from "../features/production/ProductionLedger";
import {
  buildProductionDailyRows,
  filterProductionEntries,
  getDailyTeamRoster,
  summarizeProductionDay,
  summarizeSeason,
} from "../features/production/productionSelectors";
import ProductionSummary from "../features/production/ProductionSummary";
import useProduction from "../features/production/useProduction";
import DailySummaryTiles from "../features/work/shared/DailySummaryTiles";
import WorkDateBar from "../features/work/shared/WorkDateBar";
import { formatCurrency, formatNumber } from "../utils/formatCurrency";
import { formatDate, toISODate } from "../utils/formatDate";

/**
 * Patlavale daily production sheet: pick a day, type each team's maaps, save every team at once.
 * Payable bricks = maaps x 250 (4 maaps = 1,000); earnings = maaps / 4 x team rate. Every maap is paid; there is no carry-forward.
 * Payments never change anything on this page. Below the sheet, History lets the owner correct or delete one entry.
 */
export default function PatlavaleProduction() {
  const toast = useToast();
  const { teams, activeTeams, entries, preview, saveProductionDay, updateProductionEntry, deleteProductionEntry } = useProduction();

  const today = toISODate();
  const [date, setDate] = useState(today);
  const [draft, setDraft] = useState({}); // { [teamId]: { maaps?, note? } } typed since the last save
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("ALL"); // ALL | NOT_ENTERED | ENTERED
  const [pendingDate, setPendingDate] = useState(null);
  const [confirmSave, setConfirmSave] = useState(false);

  // History section
  const [teamId, setTeamId] = useState("ALL");
  const [period, setPeriod] = useState("ALL");
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);

  const roster = useMemo(() => getDailyTeamRoster(activeTeams, date), [activeTeams, date]);
  const rows = useMemo(() => buildProductionDailyRows({ roster, entries, date, draft }), [roster, entries, date, draft]);
  const day = useMemo(() => summarizeProductionDay(rows), [rows]);

  const changed = useMemo(() => rows.filter((r) => r.dirty), [rows]);
  const invalid = useMemo(() => rows.filter((r) => r.error), [rows]);
  const dirty = changed.length > 0;
  const isPast = date < today;

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter === "NOT_ENTERED" && r.entered) return false;
      if (filter === "ENTERED" && !r.entered) return false;
      return !q || r.owner.name.toLowerCase().includes(q) || r.owner.id.toLowerCase().includes(q) || r.owner.mobile?.includes(q);
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
    const count = saveProductionDay(
      date,
      changed.map((r) => ({ teamId: r.owner.id, maaps: Number(r.text), note: r.note.trim() })),
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
    `${changed.length} ${changed.length === 1 ? "team" : "teams"} will be saved for ${formatDate(date)}.`,
    day.notEntered > 0 ? `${day.notEntered} ${day.notEntered === 1 ? "team has" : "teams have"} no entry for this day.` : "",
  ]
    .filter(Boolean)
    .join(" ");

  const saveButton = (extraClass) => (
    <Button leftIcon={Save} onClick={requestSave} disabled={!dirty} className={extraClass}>
      Save Daily Entries
    </Button>
  );

  // ---- history ----
  const seasonEntries = useMemo(
    () => (teamId === "ALL" ? entries : entries.filter((e) => e.teamId === teamId)),
    [entries, teamId]
  );
  const season = useMemo(() => summarizeSeason(seasonEntries), [seasonEntries]);
  const ledger = useMemo(
    () => [...filterProductionEntries(entries, { teamId, period, today })].reverse(),
    [entries, teamId, period, today]
  );
  const scope = teamId === "ALL" ? `All ${teams.length} teams` : (teams.find((t) => t.id === teamId)?.name ?? "");
  const hasFilters = teamId !== "ALL" || period !== "ALL";

  return (
    <div className="space-y-4 sm:space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="type-page-heading">Patlavale Production</h1>
          <p className="mt-1 text-sm text-fg-muted">
            Enter each team's maaps for the day, then save once.{" "}
            <strong className="font-semibold text-fg">4 maaps = 1,100 physical bricks = 1,000 payable bricks</strong> (250 payable per maap). Every maap is paid.
          </p>
        </div>
        <div className="hidden lg:block">{saveButton()}</div>
      </div>

      {activeTeams.length === 0 ? (
        <Card>
          <p className="p-4 text-sm text-fg-muted">
            There is no active Patlavale team. Add one in{" "}
            <Link to="/labours" className="font-medium text-primary">
              Labour Management
            </Link>{" "}
            (choose the Patlavale type) to record production.
          </p>
        </Card>
      ) : (
        <>
          <WorkDateBar date={date} today={today} onChange={requestDateChange} label="Production date" />

          <DailySummaryTiles
            tiles={[
              { label: "Maaps entered", value: formatNumber(day.maaps), sub: formatDate(date) },
              { label: "Payable bricks", value: formatNumber(day.payableBricks), sub: "250 per maap" },
              { label: "Estimated earnings", value: formatCurrency(day.earnings), sub: formatDate(date) },
              { label: "Teams with entries", value: `${day.entered} / ${day.total}`, sub: `${day.notEntered} not entered` },
            ]}
          />

          <div className="space-y-3">
            <SearchInput value={search} onChange={setSearch} placeholder="Search team by name or ID..." />
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
            <EmptyState title="No team on this day" description="No active Patlavale team had joined by this date." />
          ) : visible.length === 0 ? (
            <EmptyState title="No team found" description="Try a different search or filter." />
          ) : (
            <ul className="space-y-2.5">
              {visible.map((row) => (
                <ProductionDailyRow key={row.owner.id} row={row} onMaapsChange={setMaaps} onNoteChange={setNote} />
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
          <h2 className="type-section-heading text-lg font-semibold">Production history</h2>
          <p className="text-sm text-fg-muted">Season-to-date totals and the full ledger. Correct or delete a single saved entry.</p>
        </div>
        <ProductionFilters teams={teams} teamId={teamId} onTeamChange={setTeamId} period={period} onPeriodChange={setPeriod} />
        <ProductionSummary summary={season} scope={scope} />
        <Card className="p-4 sm:p-5">
          <ProductionLedger
            key={`${teamId}|${period}`}
            entries={ledger}
            onEdit={setEditing}
            onDelete={setDeleting}
            emptyTitle={hasFilters ? "No production entries found" : "No production entries yet"}
            emptyDescription={hasFilters ? "Try a different team or period." : "Saved daily entries appear here."}
            emptyAction={
              hasFilters ? (
                <Button
                  variant="outline"
                  onClick={() => {
                    setTeamId("ALL");
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

      <ProductionEntryModal
        open={Boolean(editing)}
        entry={editing}
        allTeams={teams}
        preview={preview}
        onClose={() => setEditing(null)}
        onSubmit={(values) => {
          updateProductionEntry(editing.id, { date: values.date, newMaaps: values.maaps, note: values.note }, values.reason);
          toast.success("Production entry corrected");
          setEditing(null);
        }}
      />

      <ConfirmDialog
        open={confirmSave}
        variant="primary"
        title={isPast ? "Save changes to a previous day?" : "Some teams have no entry"}
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
        title="Delete production entry?"
        message={
          deleting
            ? `${formatNumber(deleting.newMaaps)} maaps by ${deleting.teamName} on ${formatDate(deleting.date)} will be removed. Other days are not affected. Payments are not affected. This is recorded in the audit log.`
            : ""
        }
        confirmText="Delete"
        requireReason
        reasonLabel="Reason for deleting"
        onConfirm={(reason) => {
          deleteProductionEntry(deleting.id, reason);
          toast.success("Production entry deleted");
          setDeleting(null);
        }}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}
