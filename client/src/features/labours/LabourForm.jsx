import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { IndianRupee, Users } from "lucide-react";
import { DatePicker, Input, Select } from "../../components/ui";
import { LABOUR_STATUS_OPTIONS } from "../../utils/labourStatus";
import { LABOUR_TYPE_META, LABOUR_TYPES } from "../../utils/labourTypes";
import { labourSchema } from "../../validators/labourValidator";
import LabourTypeBadge from "./LabourTypeBadge";
import LabourTypeSelect from "./LabourTypeSelect";

/**
 * Shared by AddLabourModal and EditLabourModal. Submit it from a modal footer with <Button type="submit" form={formId}>.
 *
 * mode "add":  choose the type; the rate field and labels follow the type.
 * mode "edit": type and rate are read-only (the rate changes through its own flow, never here).
 * isMobileTaken(mobile): true if another labour already uses it.
 */
export default function LabourForm({ formId, mode = "add", defaultValues, labourId, isMobileTaken, onSubmit }) {
  const isEdit = mode === "edit";

  const {
    register,
    handleSubmit,
    setError,
    setValue,
    control,
    watch,
    formState: { errors },
  } = useForm({ resolver: zodResolver(labourSchema), defaultValues });

  const labourType = watch("labourType");
  const meta = LABOUR_TYPE_META[labourType];
  const isTeam = labourType === LABOUR_TYPES.PATLAVALE;

  const submit = (values) => {
    if (isMobileTaken(values.mobile)) {
      setError("mobile", { type: "validate", message: "This mobile number is already registered" });
      return;
    }
    onSubmit(values);
  };

  return (
    <form id={formId} onSubmit={handleSubmit(submit)} noValidate className="grid gap-4 sm:grid-cols-2">
      <div className="sm:col-span-2">
        {isEdit ? (
          <div className="rounded-lg bg-background px-4 py-3">
            <p className="text-sm font-medium">Labour Type</p>
            <div className="mt-1.5 flex items-center gap-2">
              <LabourTypeBadge type={labourType} size="md" />
              <span className="type-small">Cannot be changed after the record is created.</span>
            </div>
          </div>
        ) : (
          <Controller
            name="labourType"
            control={control}
            render={({ field }) => (
              <LabourTypeSelect
                value={field.value}
                onChange={(next) => {
                  field.onChange(next);
                  setValue("rate", ""); // a rate typed for one type must never carry over to another
                }}
              />
            )}
          />
        )}
      </div>

      {isTeam && (
        <div className="flex items-start gap-2.5 rounded-lg bg-warning-soft p-3 text-sm text-amber-900 sm:col-span-2">
          <Users className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p>
            A Patlavale <strong>family / team is one salary account</strong>. Salary is paid to the team and the family shares it
            themselves. Family members are not paid separately.
          </p>
        </div>
      )}

      <Input label="Labour ID" value={labourId} readOnly hint="Auto-generated" className="bg-background font-medium" />

      <Input
        label={meta.nameLabel}
        required
        placeholder={isTeam ? "e.g. Ganpat Jadhav Family" : "Full name"}
        autoFocus={!isEdit && typeof window !== "undefined" && window.matchMedia("(pointer: fine)").matches}
        error={errors.name?.message}
        {...register("name")}
      />

      <Input
        label={meta.mobileLabel}
        required
        inputMode="numeric"
        maxLength={10}
        placeholder="9876543210"
        error={errors.mobile?.message}
        {...register("mobile")}
      />

      <Input label="Village" required placeholder="Village name" error={errors.village?.message} {...register("village")} />

      <DatePicker label="Joining Date" required error={errors.joiningDate?.message} {...register("joiningDate")} />

      <Input
        label={meta.rateInputLabel}
        required
        type="number"
        inputMode="decimal"
        min="0"
        step="any"
        leftIcon={IndianRupee}
        placeholder={meta.ratePlaceholder}
        readOnly={isEdit}
        hint={isEdit ? meta.rateLockedHint : meta.rateHint}
        className={isEdit ? "cursor-not-allowed bg-background text-fg-muted" : undefined}
        error={errors.rate?.message}
        {...register("rate")}
      />

      <Select label="Status" options={LABOUR_STATUS_OPTIONS} error={errors.status?.message} {...register("status")} />
    </form>
  );
}
