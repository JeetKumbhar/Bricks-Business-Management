import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus } from "lucide-react";
import { Button, ConfirmDialog, useToast } from "../components/ui";
import AddLabourModal from "../features/labours/AddLabourModal";
import EditLabourModal from "../features/labours/EditLabourModal";
import LabourFilters from "../features/labours/LabourFilters";
import { filterLabours, getLabourCounts } from "../features/labours/labourSelectors";
import LabourSummaryCards from "../features/labours/LabourSummaryCards";
import LabourTable from "../features/labours/LabourTable";
import useLabours from "../features/labours/useLabours";
import { LABOUR_STATUS } from "../utils/labourStatus";

export default function LabourManagement() {
  const navigate = useNavigate();
  const toast = useToast();
  const { labours, nextLabourId, addLabour, updateLabour, isMobileTaken } = useLabours();

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("ALL");
  const [page, setPage] = useState(1);

  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState(null); // labour being edited
  const [toggling, setToggling] = useState(null); // labour whose status is being changed

  const counts = useMemo(() => getLabourCounts(labours), [labours]);
  const filtered = useMemo(() => filterLabours(labours, { search, status }), [labours, search, status]);
  const hasFilters = search.trim() !== "" || status !== "ALL";

  const handleSearch = (value) => {
    setSearch(value);
    setPage(1);
  };
  const handleStatus = (value) => {
    setStatus(value);
    setPage(1);
  };
  const clearFilters = () => {
    setSearch("");
    setStatus("ALL");
    setPage(1);
  };

  const handleAdd = (values) => {
    const labour = addLabour(values);
    setAddOpen(false);
    clearFilters();
    setPage(Number.MAX_SAFE_INTEGER); // table clamps this to the last page, where the new labour appears
    toast.success(`${labour.name} added as ${labour.id}`);
  };

  const handleEdit = (id, values) => {
    const changes = { ...values };
    delete changes.dailyRate; // rate is fixed once set
    updateLabour(id, changes);
    setEditing(null);
    toast.success("Labour updated");
  };

  const handleToggleConfirm = () => {
    const nextStatus = toggling.status === LABOUR_STATUS.ACTIVE ? LABOUR_STATUS.INACTIVE : LABOUR_STATUS.ACTIVE;
    updateLabour(toggling.id, { status: nextStatus });
    toast.success(`${toggling.name} marked ${nextStatus === LABOUR_STATUS.ACTIVE ? "active" : "inactive"}`);
    setToggling(null);
  };

  const deactivating = toggling?.status === LABOUR_STATUS.ACTIVE;

  return (
    <div className="space-y-4 sm:space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="type-page-heading">Labour Management</h1>
          <p className="mt-1 text-sm text-fg-muted">Manage your workforce, track attendance, rates and salary records.</p>
        </div>
        <Button leftIcon={Plus} onClick={() => setAddOpen(true)} className="hidden self-start sm:inline-flex">
          Add Labour
        </Button>
      </div>

      <LabourSummaryCards counts={counts} onSelectFilter={handleStatus} />

      <LabourFilters
        search={search}
        onSearchChange={handleSearch}
        status={status}
        onStatusChange={handleStatus}
        counts={counts}
      />

      <LabourTable
        labours={filtered}
        page={page}
        onPageChange={setPage}
        onView={(l) => navigate(`/labours/${l.id}`)}
        onEdit={setEditing}
        onToggleStatus={setToggling}
        hasFilters={hasFilters}
        onClearFilters={clearFilters}
      />

      {/* Phones: floating add button above the bottom nav */}
      <button
        type="button"
        aria-label="Add labour"
        onClick={() => setAddOpen(true)}
        className="fixed bottom-[calc(4.75rem+env(safe-area-inset-bottom))] right-4 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-white shadow-pop transition-transform active:scale-95 sm:hidden"
      >
        <Plus className="h-6 w-6" aria-hidden="true" />
      </button>

      <AddLabourModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        nextLabourId={nextLabourId}
        isMobileTaken={(mobile) => isMobileTaken(mobile)}
        onSubmit={handleAdd}
      />

      <EditLabourModal
        labour={editing}
        onClose={() => setEditing(null)}
        isMobileTaken={(mobile) => isMobileTaken(mobile, editing?.id)}
        onSubmit={handleEdit}
      />

      <ConfirmDialog
        open={Boolean(toggling)}
        variant={deactivating ? "danger" : "primary"}
        title={deactivating ? "Mark labour as inactive?" : "Mark labour as active?"}
        message={
          deactivating
            ? `${toggling?.name} will be marked inactive. All attendance, payments and balance are kept, and you can reactivate them anytime.`
            : `${toggling?.name} will be marked active again.`
        }
        confirmText={deactivating ? "Mark inactive" : "Mark active"}
        onConfirm={handleToggleConfirm}
        onCancel={() => setToggling(null)}
      />
    </div>
  );
}
