import { useMemo } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { DatePicker, Input, Textarea } from "../../components/ui";
import { toISODate } from "../../utils/formatDate";
import { validateMaapCount } from "../../utils/workCalculations";
import { makeProductionEntrySchema } from "../../validators/productionEntryValidator";
import LabourPicker from "../payments/LabourPicker";
import ProductionPreview from "./ProductionPreview";

/**
 * Correction form for ONE saved entry (new production is entered on the daily list).
 * Fields you type: Date, Maaps, Note, Reason. The team is locked. Everything else (physical and payable bricks,
 * rate, earnings) is calculated and shown read-only in ProductionPreview.
 * Submit from a modal footer with <Button type="submit" form={formId}>.
 */
export default function ProductionEntryForm({ formId, entry, allTeams, defaultDate, preview, onSubmit }) {
  const isEdit = Boolean(entry);
  const schema = useMemo(() => makeProductionEntrySchema({ isEdit }), [isEdit]);

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
      ? { teamId: entry.teamId, date: entry.date, maaps: String(entry.newMaaps), note: entry.note ?? "", reason: "" }
      : { teamId: "", date: defaultDate, maaps: "", note: "", reason: "" },
  });

  const [teamId, date, maapsText] = watch(["teamId", "date", "maaps"]);
  const team = allTeams.find((t) => t.id === teamId);
  const rate = isEdit ? entry.ratePer1000PayableBricks : (team?.ratePer1000PayableBricks ?? 0);
  const maapsValid = validateMaapCount(maapsText) === null;

  const result = team && maapsValid ? preview({ newMaaps: Number(maapsText), ratePer1000PayableBricks: rate }) : null;

  const submit = (values) => {
    if (team && values.date < team.joiningDate) {
      setError("date", { type: "validate", message: `${team.name} had not joined on this date` });
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
      <DatePicker label="Production Date" required max={toISODate()} error={errors.date?.message} {...register("date")} />

      <Controller
        name="teamId"
        control={control}
        render={({ field }) => (
          <LabourPicker
            label="Patlavale Family / Team"
            placeholder="Select family / team"
            labours={allTeams}
            value={field.value}
            onChange={field.onChange}
            error={errors.teamId?.message}
            disabled={isEdit}
          />
        )}
      />

      <Input
        label="Maaps Produced"
        required
        type="number"
        inputMode="numeric"
        min="0"
        step="1"
        placeholder="e.g. 5"
        hint="Whole maaps only. 4 maaps = 1,000 payable bricks (250 per maap). 0 means no production."
        error={errors.maaps?.message}
        {...register("maaps")}
      />

      <ProductionPreview entry={result} rate={rate} />

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
