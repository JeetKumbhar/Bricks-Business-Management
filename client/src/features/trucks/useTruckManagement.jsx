import { useState } from "react";
import { useToast } from "../../components/ui";
import { TRUCK_STATUS_META } from "../../utils/truckStatus";
import ServiceRecordModal from "./ServiceRecordModal";
import StatusChangeModal from "./StatusChangeModal";
import TruckDetailsModal from "./TruckDetailsModal";
import TruckFormModal from "./TruckFormModal";
import useTrucks from "./useTrucks";

/**
 * The truck actions shared by the Trucks page and the single-truck page: add / edit, update status,
 * status history + maintenance. `modals` must be rendered once by the page that uses this hook.
 * (The original logic of pages/Trucks.jsx, moved here unchanged apart from the optional nickname.)
 */
export default function useTruckManagement() {
  const toast = useToast();
  const data = useTrucks();
  const { trucks, eligibleDrivers, allLabours, isTruckNumberTaken, addTruck, updateTruck, changeStatus, addServiceRecord, getHistory, getMaintenance } = data;

  const [form, setForm] = useState(null); // { truck: null } = add, { truck } = edit
  const [statusFor, setStatusFor] = useState(null);
  const [detailsFor, setDetailsFor] = useState(null);
  const [serviceFor, setServiceFor] = useState(null);

  const detailsTruck = detailsFor ? (trucks.find((t) => t.id === detailsFor) ?? null) : null;

  const handleFormSubmit = (values) => {
    if (form.truck) {
      const nameOf = (id) => allLabours.find((l) => l.id === id)?.name ?? "no driver";
      updateTruck(
        form.truck.id,
        { truckNumber: values.truckNumber, nickname: values.nickname, model: values.model, capacity: values.capacity, driverId: values.driverId },
        { describeDriver: `Driver changed from ${nameOf(form.truck.driverId)} to ${nameOf(values.driverId)}` }
      );
      toast.success("Truck updated");
    } else {
      const truck = addTruck({ truckNumber: values.truckNumber, nickname: values.nickname, model: values.model, capacity: values.capacity, driverId: values.driverId });
      toast.success(`${truck.truckNumber} added`);
    }
    setForm(null);
  };

  const handleStatusSubmit = (id, values) => {
    changeStatus(id, { status: values.status, reason: values.reason, note: values.note, description: values.description, cost: values.cost });
    toast.success(`Status changed to ${TRUCK_STATUS_META[values.status].label}`);
    setStatusFor(null);
  };

  const handleServiceSubmit = (truckId, values) => {
    addServiceRecord(truckId, { date: values.date, description: values.description, cost: values.cost });
    toast.success("Service record added");
    setServiceFor(null);
  };

  const modals = (
    <>
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
    </>
  );

  return {
    ...data,
    openAdd: () => setForm({ truck: null }),
    openEdit: (truck) => setForm({ truck }),
    openStatus: setStatusFor,
    openHistory: (truck) => setDetailsFor(truck.id),
    modals,
  };
}
