import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Plus } from "lucide-react";
import { Button, Card, ConfirmDialog, useToast } from "../components/ui";
import ProductionEntryModal from "../features/production/ProductionEntryModal";
import ProductionFilters from "../features/production/ProductionFilters";
import ProductionLedger from "../features/production/ProductionLedger";
import { filterProductionEntries, summarizeSeason } from "../features/production/productionSelectors";
import ProductionSummary from "../features/production/ProductionSummary";
import useProduction from "../features/production/useProduction";
import { formatCurrency, formatNumber } from "../utils/formatCurrency";
import { formatDate, toISODate } from "../utils/formatDate";

/**
 * Patlavale production ledger.
 * Every 1,100 physical bricks pay for 1,000 payable bricks; the remainder carries forward through the season.
 * Payments never change anything on this page.
 */
export default function PatlavaleProduction() {
  const toast = useToast();
  const { teams, activeTeams, entries, preview, addProductionEntry, updateProductionEntry, deleteProductionEntry } = useProduction();

  const today = toISODate();
  const [teamId, setTeamId] = useState("ALL");
  const [period, setPeriod] = useState("ALL");

  // null = closed. { entry: null } = add, { entry } = edit. key / defaultDate support "Save & Add Another".
  const [modal, setModal] = useState(null);
  const [deleting, setDeleting] = useState(null);

  // `entries` is oldest first (the carry-forward order). The ledger shows newest first.
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
  const canAdd = activeTeams.length > 0;

  const openAdd = () => setModal({ entry: null, key: 0, defaultDate: today });

  const handleSubmit = (values, intent) => {
    if (modal.entry) {
      updateProductionEntry(
        modal.entry.id,
        { date: values.date, newPhysicalBricks: values.bricks, note: values.note },
        values.reason
      );
      toast.success("Production entry corrected");
      setModal(null);
      return;
    }

    const saved = addProductionEntry({
      teamId: values.teamId,
      date: values.date,
      newPhysicalBricks: values.bricks,
      note: values.note,
    });
    const name = teams.find((t) => t.id === saved.teamId)?.name ?? saved.teamId;
    toast.success(
      `${name}: ${formatNumber(saved.newPayableBricks)} payable, ${formatCurrency(saved.newEarnings)}, carry ${formatNumber(saved.carryForwardBricks)}`
    );

    if (intent === "another") {
      // keep the sheet open for the next team, on the same date
      setModal((m) => ({ ...m, key: m.key + 1, defaultDate: values.date }));
    } else {
      setModal(null);
    }
  };

  const handleDelete = (reason) => {
    deleteProductionEntry(deleting.id, reason);
    toast.success("Production entry deleted");
    setDeleting(null);
  };

  return (
    <div className="space-y-4 sm:space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="type-page-heading">Patlavale Production</h1>
          <p className="mt-1 text-sm text-fg-muted">
            Raw bricks made by each family / team. Every 1,100 physical bricks pay for 1,000 payable bricks.
          </p>
        </div>
        <Button leftIcon={Plus} onClick={openAdd} disabled={!canAdd} className="hidden self-start sm:inline-flex">
          Add Production Entry
        </Button>
      </div>

      {!canAdd && (
        <Card>
          <p className="p-4 text-sm text-fg-muted">
            There is no active Patlavale team. Add one in{" "}
            <Link to="/labours" className="font-medium text-primary">
              Labour Management
            </Link>{" "}
            (choose the Patlavale type) to record production.
          </p>
        </Card>
      )}

      <ProductionFilters teams={teams} teamId={teamId} onTeamChange={setTeamId} period={period} onPeriodChange={setPeriod} />

      <ProductionSummary summary={season} scope={scope} />

      <Card className="p-4 sm:p-5">
        <ProductionLedger
          key={`${teamId}|${period}`}
          entries={ledger}
          onEdit={(entry) => setModal({ entry, key: 0, defaultDate: entry.date })}
          onDelete={setDeleting}
          emptyTitle={hasFilters ? "No production entries found" : "No production entries yet"}
          emptyDescription={hasFilters ? "Try a different team or period." : "Add the first entry with the button below."}
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

      {/* Phones: floating add button above the bottom nav */}
      {canAdd && (
        <button
          type="button"
          aria-label="Add production entry"
          onClick={openAdd}
          className="fixed bottom-[calc(4.75rem+env(safe-area-inset-bottom))] right-4 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-white shadow-pop transition-transform active:scale-95 sm:hidden"
        >
          <Plus className="h-6 w-6" aria-hidden="true" />
        </button>
      )}

      <ProductionEntryModal
        open={Boolean(modal)}
        entry={modal?.entry ?? null}
        teams={activeTeams}
        allTeams={teams}
        defaultDate={modal?.defaultDate ?? today}
        formKey={modal?.key ?? 0}
        preview={preview}
        onClose={() => setModal(null)}
        onSubmit={handleSubmit}
      />

      <ConfirmDialog
        open={Boolean(deleting)}
        variant="danger"
        title="Delete production entry?"
        message={
          deleting
            ? `${formatNumber(deleting.newPhysicalBricks)} bricks by ${deleting.teamName} on ${formatDate(deleting.date)} will be removed. Later entries for this team are recalculated, because the carry-forward changes. Payments are not affected. This is recorded in the audit log.`
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
