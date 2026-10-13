import { useMemo, useRef } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { DatePicker, Input, Textarea } from "../../components/ui";
import { toISODate } from "../../utils/formatDate";
import { validatePhysicalBricks } from "../../utils/productionCalculations";
import { makeProductionEntrySchema } from "../../validators/productionEntryValidator";
import LabourPicker from "../payments/LabourPicker";
import ProductionPreview from "./ProductionPreview";

/**
 * Fields you type: Date, Patlavale family / team, New physical bricks, Note (+ reason when correcting).
 * Everything else (previous carry, available, groups, payable, remaining carry, rate, earnings) is calculated
 * and shown read-only in ProductionPreview.
 * Submit from a modal footer with <Button type="submit" form={formId} value="close" | "another">.
 */
export default function ProductionEntryForm({ formId, entry, teams, allTeams, defaultDate, preview, onSubmit }) {
  const isEdit = Boolean(entry);
  const schema = useMemo(() => makeProductionEntrySchema({ isEdit }), [isEdit]);
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
      ? { teamId: entry.teamId, date: entry.date, bricks: String(entry.newPhysicalBricks), note: entry.note ?? "", reason: "" }
      : { teamId: "", date: defaultDate, bricks: "", note: "", reason: "" },
  });

  const [teamId, date, bricksText] = watch(["teamId", "date", "bricks"]);
  const team = allTeams.find((t) => t.id === teamId);
  const rate = isEdit ? entry.ratePer1000PayableBricks : (team?.ratePer1000PayableBricks ?? 0);
  const bricksValid = validatePhysicalBricks(bricksText) === null;

  const result =
    team && date && bricksValid
      ? preview({
          id: entry?.id,
          createdAt: entry?.createdAt,
          teamId,
          date,
          newPhysicalBricks: Number(bricksText),
          ratePer1000PayableBricks: rate,
        })
      : null;

  const submit = (values) => {
    if (team && values.date < team.joiningDate) {
      setError("date", { type: "validate", message: `${team.name} had not joined on this date` });
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
      <DatePicker label="Production Date" required max={toISODate()} error={errors.date?.message} {...register("date")} />

      <Controller
        name="teamId"
        control={control}
        render={({ field }) => (
          <LabourPicker
            label="Patlavale Family / Team"
            placeholder="Select family / team"
            labours={isEdit ? allTeams : teams}
            value={field.value}
            onChange={field.onChange}
            error={errors.teamId?.message}
            disabled={isEdit}
          />
        )}
      />

      <Input
        label="New Physical Bricks Produced"
        required
        type="number"
        inputMode="numeric"
        min="1"
        step="1"
        placeholder="e.g. 1500"
        hint="Whole bricks only. Every 1,100 physical bricks pay for 1,000 payable bricks."
        error={errors.bricks?.message}
        {...register("bricks")}
      />

      <ProductionPreview result={result} rate={rate} isEdit={isEdit} />

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
