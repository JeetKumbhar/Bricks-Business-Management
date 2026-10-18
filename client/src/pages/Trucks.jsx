import { useMemo, useState } from "react";
import { Plus, Truck as TruckIcon } from "lucide-react";
import { Button, Card, EmptyState, useToast } from "../components/ui";
import ServiceRecordModal from "../features/trucks/ServiceRecordModal";
import StatusChangeModal from "../features/trucks/StatusChangeModal";
import TruckCard from "../features/trucks/TruckCard";
import TruckDetailsModal from "../features/trucks/TruckDetailsModal";
import TruckFilters from "../features/trucks/TruckFilters";
import TruckFormModal from "../features/trucks/TruckFormModal";
import TruckSummaryTiles from "../features/trucks/TruckSummaryTiles";
import useTrucks from "../features/trucks/useTrucks";
import { TRUCK_STATUS_META } from "../utils/truckStatus";

/**
 * Trucks: Working / Stopped / Maintenance, stop reasons, status history and maintenance records.
 * Separate from labour earnings. A driver is only a link to a labour record (see DRIVERS_LINKED_TO_LABOUR).
 */
export default function Trucks() {
  const toast = useToast();
  const { trucks, summary, eligibleDrivers, allLabours, isTruckNumberTaken, addTruck, updateTruck, changeStatus, addServiceRecord, getHistory, getMaintenance } =
    useTrucks();

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("ALL");
  const [form, setForm] = useState(null); // { truck: null } = add, { truck } = edit
  const [statusFor, setStatusFor] = useState(null);
  const [detailsFor, setDetailsFor] = useState(null);
  const [serviceFor, setServiceFor] = useState(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return trucks.filter(
      (t) =>
        (status === "ALL" || t.status === status) &&
        (!q || t.truckNumber.toLowerCase().includes(q) || t.model.toLowerCase().includes(q) || (t.driverName ?? "").toLowerCase().includes(q))
    );
  }, [trucks, search, status]);

  // keep the details window in sync after changes (it holds an id, not a stale copy)
  const detailsTruck = detailsFor ? (trucks.find((t) => t.id === detailsFor) ?? null) : null;

  const handleFormSubmit = (values) => {
    if (form.truck) {
      const nameOf = (id) => allLabours.find((l) => l.id === id)?.name ?? "no driver";
      updateTruck(
        form.truck.id,
        { truckNumber: values.truckNumber, model: values.model, capacity: values.capacity, driverId: values.driverId },
        { describeDriver: `Driver changed from ${nameOf(form.truck.driverId)} to ${nameOf(values.driverId)}` }
      );
      toast.success("Truck updated");
    } else {
      const truck = addTruck({ truckNumber: values.truckNumber, model: values.model, capacity: values.capacity, driverId: values.driverId });
      toast.success(`${truck.truckNumber} added`);
    }
    setForm(null);
  };

  const handleStatusSubmit = (id, values) => {
    changeStatus(id, {
      status: values.status,
      reason: values.reason,
      note: values.note,
      description: values.description,
      cost: values.cost,
    });
    toast.success(`Status changed to ${TRUCK_STATUS_META[values.status].label}`);
    setStatusFor(null);
  };

  const handleServiceSubmit = (truckId, values) => {
    addServiceRecord(truckId, { date: values.date, description: values.description, cost: values.cost });
    toast.success("Service record added");
    setServiceFor(null);
  };

  return (
    <div className="space-y-4 sm:space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="type-page-heading">Trucks</h1>
          <p className="mt-1 text-sm text-fg-muted">Status, stop reasons, history and maintenance. Separate from labour earnings.</p>
        </div>
        <Button leftIcon={Plus} onClick={() => setForm({ truck: null })} className="hidden self-start sm:inline-flex">
          Add Truck
        </Button>
      </div>

      <TruckSummaryTiles summary={summary} status={status} onSelect={setStatus} />

      <TruckFilters search={search} onSearchChange={setSearch} status={status} onStatusChange={setStatus} summary={summary} />

      {filtered.length === 0 ? (
        <Card>
          <EmptyState
            icon={TruckIcon}
            title="No trucks found"
            description="Try a different search or status."
            action={
              <Button
                variant="outline"
                onClick={() => {
                  setSearch("");
                  setStatus("ALL");
                }}
              >
                Clear filters
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((t) => (
            <TruckCard key={t.id} truck={t} onUpdateStatus={setStatusFor} onDetails={(truck) => setDetailsFor(truck.id)} onEdit={(truck) => setForm({ truck })} />
          ))}
        </div>
      )}

      {/* Phones: floating add button above the bottom nav */}
      <button
        type="button"
        aria-label="Add truck"
        onClick={() => setForm({ truck: null })}
        className="fixed bottom-[calc(4.75rem+env(safe-area-inset-bottom))] right-4 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-white shadow-pop transition-transform active:scale-95 sm:hidden"
      >
        <Plus className="h-6 w-6" aria-hidden="true" />
      </button>

      <TruckFormModal
        open={Boolean(form)}
        truck={form?.truck ?? null}
        drivers={eligibleDrivers}
        allLabours={allLabours}
        isTruckNumberTaken={isTruckNumberTaken}
        onClose={() => setForm(null)}
        onSubmit={handleFormSubmit}
      />

      <StatusChangeModal truck={statusFor ? (trucks.find((t) => t.id === statusFor.id) ?? null) : null} onClose={() => setStatusFor(null)} onSubmit={handleStatusSubmit} />

      <TruckDetailsModal
        truck={detailsTruck}
        history={detailsTruck ? getHistory(detailsTruck.id) : []}
        maintenance={detailsTruck ? getMaintenance(detailsTruck.id) : []}
        onClose={() => setDetailsFor(null)}
        onAddService={setServiceFor}
      />

      <ServiceRecordModal truck={serviceFor} onClose={() => setServiceFor(null)} onSubmit={handleServiceSubmit} />
    </div>
  );
}
