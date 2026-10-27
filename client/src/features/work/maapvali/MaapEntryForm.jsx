import { useMemo } from "react";
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
 * Correction form for ONE saved entry (new work is entered on the daily list). Fields: Date, worker (locked),
 * Number of maaps, Rate per 4 maaps (read-only), Earnings preview, Note, Reason.
 * Submit from a modal footer with <Button type="submit" form={formId}>.
 *
 * The rate is filled from the worker's profile and cannot be changed here. In edit mode the worker is locked and
 * a reason for the correction is required.
 */
export default function MaapEntryForm({ formId, entry, allWorkers, defaultDate, previewEntry, onSubmit }) {
  const isEdit = Boolean(entry);
  const schema = useMemo(() => makeMaapEntrySchema({ isEdit }), [isEdit]);

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
  const rate = isEdit ? entry.ratePerFourMaaps : (worker?.ratePerFourMaaps ?? 0);
  const maaps = validateMaapCount(maapsText) === null ? Number(maapsText) : null;
  const preview = maaps !== null && rate > 0 ? previewEntry({ numberOfMaaps: maaps, ratePerFourMaaps: rate }) : null;

  const submit = (values) => {
    if (worker && values.date < worker.joiningDate) {
      setError("date", { type: "validate", message: `${worker.name} had not joined on this date` });
      return;
    }
    onSubmit(values);
  };

  return (
    <form
      id={formId}
      noValidate
      className="space-y-4"
      onSubmit={handleSubmit(submit)}
    >
      <DatePicker label="Date" required max={toISODate()} error={errors.date?.message} {...register("date")} />

      <Controller
        name="labourId"
        control={control}
        render={({ field }) => (
          <LabourPicker
            label="Maapvali Worker"
            placeholder="Select Maapvali worker"
            labours={allWorkers}
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
        min="0"
        step="1"
        placeholder="e.g. 32"
        hint="Whole maaps only. 0 means no work that day."
        error={errors.maaps?.message}
        {...register("maaps")}
      />

      <Input
        label="Rate per 4 Maaps (on this entry)"
        value={rate > 0 ? `${formatCurrency(rate)} / 4 maaps` : "-"}
        readOnly
        hint="The rate saved with this entry stays as it was."
        className="cursor-not-allowed bg-background font-medium text-fg"
      />

      <EarningsPreview preview={preview} />

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
