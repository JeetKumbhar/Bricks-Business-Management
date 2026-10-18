import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Badge, Button, Input, Modal, Select, Textarea } from "../../components/ui";
import { cn } from "../../utils/cn";
import { STOP_REASON_LABELS, TRUCK_STATUS, TRUCK_STATUS_META } from "../../utils/truckStatus";
import { makeStatusChangeSchema } from "../../validators/truckValidator";

const FORM_ID = "truck-status-form";
const statuses = [TRUCK_STATUS.WORKING, TRUCK_STATUS.STOPPED, TRUCK_STATUS.MAINTENANCE];

function StatusForm({ truck, onSubmit }) {
  const first = statuses.find((s) => s !== truck.status);
  const {
    register,
    handleSubmit,
    control,
    watch,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(makeStatusChangeSchema(truck.status)),
    defaultValues: { status: first, reason: "", note: "", description: "", cost: "" },
  });
  const status = watch("status");
  const leavingMaintenance = truck.status === TRUCK_STATUS.MAINTENANCE && status === TRUCK_STATUS.WORKING;

  return (
    <form id={FORM_ID} noValidate onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="flex items-center gap-2 rounded-lg bg-background px-4 py-3 text-sm">
        <span className="text-fg-muted">Now:</span>
        <Badge variant={TRUCK_STATUS_META[truck.status].variant}>{TRUCK_STATUS_META[truck.status].label}</Badge>
      </div>

      <Controller
        name="status"
        control={control}
        render={({ field }) => (
          <div className="flex flex-col gap-1.5">
            <span id="new-status-label" className="text-sm font-medium">
              New status<span className="ml-0.5 text-danger">*</span>
            </span>
            <div role="radiogroup" aria-labelledby="new-status-label" className="grid grid-cols-3 gap-2">
              {statuses.map((s) => {
                const disabled = s === truck.status;
                const selected = field.value === s;
                return (
                  <button
                    key={s}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    disabled={disabled}
                    onClick={() => field.onChange(s)}
                    className={cn(
                      "flex h-12 items-center justify-center rounded-lg border px-1 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40",
                      selected ? "border-primary bg-primary-soft text-primary" : "border-border bg-surface text-fg-muted hover:bg-background"
                    )}
                  >
                    {TRUCK_STATUS_META[s].label}
                  </button>
                );
              })}
            </div>
            {errors.status && (
              <p role="alert" className="text-xs text-danger">
                {errors.status.message}
              </p>
            )}
          </div>
        )}
      />

      {status === TRUCK_STATUS.STOPPED && (
        <Select
          label="Why did it stop?"
          required
          placeholder="Select a reason"
          options={Object.entries(STOP_REASON_LABELS).map(([value, label]) => ({ value, label }))}
          error={errors.reason?.message}
          {...register("reason")}
        />
      )}

      {status === TRUCK_STATUS.MAINTENANCE && (
        <>
          <Input label="Maintenance work" required placeholder="e.g. Engine service" error={errors.description?.message} {...register("description")} />
          <Input label="Estimated cost (optional)" type="number" inputMode="decimal" min="0" step="any" placeholder="0" error={errors.cost?.message} {...register("cost")} />
        </>
      )}

      {leavingMaintenance && (
        <Input
          label="Final maintenance cost (optional)"
          type="number"
          inputMode="decimal"
          min="0"
          step="any"
          placeholder="0"
          hint="The open maintenance record is marked completed."
          error={errors.cost?.message}
          {...register("cost")}
        />
      )}

      {status !== TRUCK_STATUS.MAINTENANCE && (
        <Textarea
          label="Note"
          required={status === TRUCK_STATUS.STOPPED && watch("reason") === "OTHER"}
          rows={2}
          placeholder={status === TRUCK_STATUS.STOPPED ? "What happened?" : "Optional"}
          error={errors.note?.message}
          {...register("note")}
        />
      )}
    </form>
  );
}

/** Change a truck's status. Every change is saved in the history (nothing is overwritten). */
export default function StatusChangeModal({ truck, onClose, onSubmit }) {
  return (
    <Modal
      open={Boolean(truck)}
      onClose={onClose}
      title="Update Status"
      description={truck ? truck.truckNumber : undefined}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form={FORM_ID}>
            Save Status
          </Button>
        </>
      }
    >
      {truck && <StatusForm key={truck.id} truck={truck} onSubmit={(values) => onSubmit(truck.id, values)} />}
    </Modal>
  );
}
