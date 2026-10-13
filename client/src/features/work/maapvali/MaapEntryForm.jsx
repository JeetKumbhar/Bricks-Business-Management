import { useMemo, useRef } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { DatePicker, Input, Textarea } from "../../../components/ui";
import { formatCurrency } from "../../../utils/formatCurrency";
import { toISODate } from "../../../utils/formatDate";
import { validateMaapCount } from "../../../utils/workCalculations";
import { makeMaapEntrySchema } from "../../../validators/maapEntryValidator";
import LabourPicker from "../../payments/LabourPicker";
import EarningsPreview from "./EarningsPreview";

/**
 * Fields: Date, Maapvali worker, Number of maaps, Rate per maap (read-only), Earnings preview, Note.
 * Submit from a modal footer with <Button type="submit" form={formId} value="close" | "another">.
 *
 * The rate is filled from the worker's profile and cannot be changed here. In edit mode the worker is locked and
 * a reason for the correction is required.
 */
export default function MaapEntryForm({ formId, entry, workers, allWorkers, defaultDate, getDayTotal, onSubmit }) {
  const isEdit = Boolean(entry);
  const schema = useMemo(() => makeMaapEntrySchema({ isEdit }), [isEdit]);
  const intent = useRef("close");

  const {
    register,
    handleSubmit,
    control,
    watch,
    setError,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(schema),
    defaultValues: isEdit
      ? { labourId: entry.labourId, date: entry.date, maaps: String(entry.numberOfMaaps), note: entry.note ?? "", reason: "" }
      : { labourId: "", date: defaultDate, maaps: "", note: "", reason: "" },
  });

  const [labourId, date, maapsText] = watch(["labourId", "date", "maaps"]);
  const worker = allWorkers.find((w) => w.id === labourId);
  const rate = isEdit ? entry.ratePerMaap : (worker?.ratePerMaap ?? 0);
  const maaps = validateMaapCount(maapsText) === null ? Number(maapsText) : null;
  const dayTotal = !isEdit && worker && date ? getDayTotal(labourId, date) : null;

  const submit = (values) => {
    if (worker && values.date < worker.joiningDate) {
      setError("date", { type: "validate", message: `${worker.name} had not joined on this date` });
      return;
    }
    onSubmit(values, intent.current);
  };

  return (
    <form
      id={formId}
      noValidate
      className="space-y-4"
      onSubmit={(e) => {
        // Which footer button was pressed: "close" (Save Entry) or "another" (Save & Add Another)
        intent.current = e.nativeEvent.submitter?.value || "close";
        handleSubmit(submit)(e);
      }}
    >
      <DatePicker label="Date" required max={toISODate()} error={errors.date?.message} {...register("date")} />

      <Controller
        name="labourId"
        control={control}
        render={({ field }) => (
          <LabourPicker
            label="Maapvali Worker"
            placeholder="Select Maapvali worker"
            labours={isEdit ? allWorkers : workers}
            value={field.value}
            onChange={field.onChange}
            error={errors.labourId?.message}
            disabled={isEdit}
          />
        )}
      />

      <Input
        label="Number of Maaps"
        required
        type="number"
        inputMode="numeric"
        min="1"
        step="1"
        placeholder="e.g. 32"
        hint="Whole maaps only. One maap is about 275 bricks."
        error={errors.maaps?.message}
        {...register("maaps")}
      />

      <Input
        label={isEdit ? "Rate per Maap (on this entry)" : "Agreed Rate per Maap"}
        value={rate > 0 ? `${formatCurrency(rate)} / maap` : "-"}
        readOnly
        hint={isEdit ? "The rate saved with this entry stays as it was." : "From the worker's profile. It cannot be changed here."}
        className="cursor-not-allowed bg-background font-medium text-fg"
      />

      <EarningsPreview maaps={maaps} rate={rate} />

      {dayTotal && dayTotal.entries > 0 && (
        <p className="rounded-lg bg-warning-soft px-3 py-2.5 text-sm text-amber-900">
          Already recorded for this date: {dayTotal.maaps} maaps ({formatCurrency(dayTotal.earnings)}). This will be saved as a
          separate entry.
        </p>
      )}

      <Textarea label="Note" rows={2} placeholder="Optional" error={errors.note?.message} {...register("note")} />

      {isEdit && (
        <Textarea
          label="Reason for correction"
          required
          rows={2}
          placeholder="Why is this entry being changed?"
          hint="Saved in the audit log."
          error={errors.reason?.message}
          {...register("reason")}
        />
      )}
    </form>
  );
}
