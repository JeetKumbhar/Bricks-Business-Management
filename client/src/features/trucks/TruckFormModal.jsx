import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button, Input, Modal, Select } from "../../components/ui";
import { DRIVERS_LINKED_TO_LABOUR } from "../../utils/truckStatus";
import { truckSchema } from "../../validators/truckValidator";

const FORM_ID = "truck-form";

function TruckForm({ truck, drivers, allLabours, isTruckNumberTaken, onSubmit }) {
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(truckSchema),
    defaultValues: {
      truckNumber: truck?.truckNumber ?? "",
      model: truck?.model ?? "",
      capacity: truck?.capacity ? String(truck.capacity) : "",
      driverId: truck?.driverId ?? "",
    },
  });

  // keep the current driver selectable even if they are no longer eligible (e.g. marked inactive)
  const driverOptions = [...drivers];
  if (truck?.driverId && !drivers.some((d) => d.id === truck.driverId)) {
    const current = allLabours.find((l) => l.id === truck.driverId);
    if (current) driverOptions.push(current);
  }

  const submit = (values) => {
    if (isTruckNumberTaken(values.truckNumber, truck?.id)) {
      setError("truckNumber", { type: "validate", message: "This truck number already exists" });
      return;
    }
    onSubmit(values);
  };

  return (
    <form id={FORM_ID} noValidate onSubmit={handleSubmit(submit)} className="space-y-4">
      <Input
        label="Truck Number"
        required
        placeholder="e.g. TRK-11 or MH15 AB 1234"
        autoFocus={typeof window !== "undefined" && window.matchMedia("(pointer: fine)").matches}
        error={errors.truckNumber?.message}
        {...register("truckNumber")}
      />
      <Input label="Model / Type" placeholder="e.g. Tata 407" error={errors.model?.message} {...register("model")} />
      <Input
        label="Capacity (tons)"
        type="number"
        inputMode="decimal"
        min="0"
        step="any"
        placeholder="Optional"
        error={errors.capacity?.message}
        {...register("capacity")}
      />
      {DRIVERS_LINKED_TO_LABOUR && (
        <Select
          label="Driver"
          hint="Chosen from active workers. A driver link does not affect anyone's earnings."
          options={[{ value: "", label: "No driver assigned" }, ...driverOptions.map((d) => ({ value: d.id, label: `${d.name} (${d.id})` }))]}
          error={errors.driverId?.message}
          {...register("driverId")}
        />
      )}
    </form>
  );
}

/** Add a truck (truck = null) or edit one. */
export default function TruckFormModal({ open, truck, drivers, allLabours, isTruckNumberTaken, onClose, onSubmit }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={truck ? "Edit Truck" : "Add Truck"}
      description={truck ? truck.truckNumber : "A new truck starts as Working."}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form={FORM_ID}>
            {truck ? "Save Changes" : "Save Truck"}
          </Button>
        </>
      }
    >
      <TruckForm truck={truck} drivers={drivers} allLabours={allLabours} isTruckNumberTaken={isTruckNumberTaken} onSubmit={onSubmit} />
    </Modal>
  );
}
