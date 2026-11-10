import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Badge, Button, Input, Modal, Select, Textarea } from "../../components/ui";
import { cn } from "../../utils/cn";
import { STOP_REASON_LABELS, TRUCK_STATUS, TRUCK_STATUS_META } from "../../utils/truckStatus";
import { makeStatusChangeSchema } from "../../validators/truckValidator";
import UnconfirmedNotice from "./UnconfirmedNotice";

const FORM_ID = "truck-status-form";
const statuses = [TRUCK_STATUS.WORKING, TRUCK_STATUS.STOPPED, TRUCK_STATUS.MAINTENANCE];

const SERVER_FIELDS = ["status", "reason", "note", "description"];

function StatusForm({ truck, onSubmit, submitting }) {
  const first = statuses.find((s) => s !== truck.status);
  const {
    register,
    handleSubmit,
    control,
    watch,
    setError,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(makeStatusChangeSchema(truck.status)),
    defaultValues: { status: first, reason: "", note: "", description: "", cost: "" }, // cost stays "" and is never sent
  });
  const status = watch("status");

  return (
    <form
      id={FORM_ID}
      noValidate
      onSubmit={handleSubmit(async (values) => {
        const result = await onSubmit(values);
        for (const [field, message] of Object.entries(result?.fieldErrors ?? {})) if (SERVER_FIELDS.includes(field)) setError(field, { type: "server", message });
      })}
      className="space-y-4"
    >
      <fieldset disabled={submitting} className="m-0 min-w-0 space-y-4 border-0 p-0">
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
          <p className="type-small">Maintenance cost cannot be saved yet, so it is not asked for.</p>
        </>
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
      </fieldset>
    </form>
  );
}

/** Change a truck's status. Every change is saved in the history (nothing is overwritten). */
export default function StatusChangeModal({ truck, submitting = false, unconfirmed = null, onRecheck, onClose, onSubmit }) {
  return (
    <Modal
      open={Boolean(truck)}
      onClose={onClose}
      title="Update Status"
      description={truck ? truck.truckNumber : undefined}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button type="submit" form={FORM_ID} loading={submitting} disabled={submitting || Boolean(unconfirmed)}>
            {submitting ? "Saving..." : "Save Status"}
          </Button>
        </>
      }
    >
      {truck && unconfirmed && <UnconfirmedNotice message={unconfirmed} onRecheck={onRecheck} busy={submitting} />}
      {truck && <StatusForm key={truck.id} truck={truck} submitting={submitting || Boolean(unconfirmed)} onSubmit={(values) => onSubmit(truck.id, values)} />}
    </Modal>
  );
}
