import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button, DatePicker, Input, Modal } from "../../components/ui";
import { toISODate } from "../../utils/formatDate";
import { serviceRecordSchema } from "../../validators/truckValidator";

const FORM_ID = "service-record-form";

function ServiceForm({ onSubmit }) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({ resolver: zodResolver(serviceRecordSchema), defaultValues: { date: toISODate(), description: "", cost: "" } });

  return (
    <form id={FORM_ID} noValidate onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <DatePicker label="Date" required max={toISODate()} error={errors.date?.message} {...register("date")} />
      <Input label="Work done" required placeholder="e.g. Tyre replacement" error={errors.description?.message} {...register("description")} />
      <Input label="Cost (optional)" type="number" inputMode="decimal" min="0" step="any" placeholder="0" error={errors.cost?.message} {...register("cost")} />
    </form>
  );
}

/** Record a service that has already been done. (Ongoing maintenance starts from "Update Status".) */
export default function ServiceRecordModal({ truck, onClose, onSubmit }) {
  return (
    <Modal
      open={Boolean(truck)}
      onClose={onClose}
      title="Add Service Record"
      description={truck ? truck.truckNumber : undefined}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form={FORM_ID}>
            Save Record
          </Button>
        </>
      }
    >
      {truck && <ServiceForm key={truck.id} onSubmit={(values) => onSubmit(truck.id, values)} />}
    </Modal>
  );
}
