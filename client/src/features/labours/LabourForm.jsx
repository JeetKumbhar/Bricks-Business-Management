import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { IndianRupee } from "lucide-react";
import { DatePicker, Input, Select } from "../../components/ui";
import { LABOUR_STATUS_OPTIONS } from "../../utils/labourStatus";
import { labourSchema } from "../../validators/labourValidator";

/**
 * Shared by AddLabourModal and EditLabourModal.
 * Submit it from a modal footer with: <Button type="submit" form={formId}>
 *
 * rateLocked: daily rate cannot be changed once set (docs/BUSINESS_RULES.md).
 * isMobileTaken(mobile): returns true if another labour already uses it.
 */
export default function LabourForm({ formId, defaultValues, labourId, rateLocked = false, isMobileTaken, onSubmit }) {
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm({ resolver: zodResolver(labourSchema), defaultValues });

  const submit = (values) => {
    if (isMobileTaken(values.mobile)) {
      setError("mobile", { type: "validate", message: "This mobile number is already registered" });
      return;
    }
    onSubmit(values);
  };

  return (
    <form id={formId} onSubmit={handleSubmit(submit)} noValidate className="grid gap-4 sm:grid-cols-2">
      <Input label="Labour ID" value={labourId} readOnly hint="Auto-generated" className="bg-background font-medium" />

      <Input label="Name" required placeholder="Full name" autoFocus={typeof window !== "undefined" && window.matchMedia("(pointer: fine)").matches} error={errors.name?.message} {...register("name")} />

      <Input
        label="Mobile"
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
        label="Daily Rate"
        required
        type="number"
        inputMode="numeric"
        min="1"
        leftIcon={IndianRupee}
        readOnly={rateLocked}
        hint={rateLocked ? "Rate is fixed once set" : undefined}
        className={rateLocked ? "cursor-not-allowed bg-background text-fg-muted" : undefined}
        error={errors.dailyRate?.message}
        {...register("dailyRate")}
      />

      <Select label="Status" options={LABOUR_STATUS_OPTIONS} error={errors.status?.message} {...register("status")} />
    </form>
  );
}
