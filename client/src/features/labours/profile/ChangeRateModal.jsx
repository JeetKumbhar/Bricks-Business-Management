import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { IndianRupee } from "lucide-react";
import { Button, DatePicker, Input, Modal, Textarea } from "../../../components/ui";
import { addDaysISO, toISODate } from "../../../utils/formatDate";
import { formatCurrency } from "../../../utils/formatCurrency";
import { rateChangeSchema } from "../../../validators/rateChangeValidator";

const FORM_ID = "change-rate-form";

function ChangeRateForm({ currentRate, minDate, onSubmit }) {
  const today = toISODate();
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(rateChangeSchema),
    defaultValues: { newRate: "", effectiveFrom: today >= minDate ? today : minDate, reason: "" },
  });

  const submit = (values) => {
    if (values.newRate === currentRate) {
      setError("newRate", { type: "validate", message: "New rate must be different from the current rate" });
      return;
    }
    if (values.effectiveFrom < minDate) {
      setError("effectiveFrom", { type: "validate", message: "Must be after the previous rate change" });
      return;
    }
    onSubmit(values);
  };

  return (
    <form id={FORM_ID} onSubmit={handleSubmit(submit)} noValidate className="space-y-4">
      <div className="rounded-lg bg-background px-4 py-3 text-sm">
        <span className="text-fg-muted">Current rate: </span>
        <span className="font-semibold">{formatCurrency(currentRate)} / day</span>
      </div>

      <Input
        label="New daily rate"
        required
        type="number"
        inputMode="numeric"
        min="1"
        leftIcon={IndianRupee}
        placeholder="e.g. 750"
        error={errors.newRate?.message}
        {...register("newRate")}
      />

      <DatePicker
        label="Effective from"
        required
        min={minDate}
        hint="Earlier attendance keeps the old rate. The new rate applies from this date."
        error={errors.effectiveFrom?.message}
        {...register("effectiveFrom")}
      />

      <Textarea
        label="Reason"
        required
        rows={2}
        placeholder="e.g. Yearly increase"
        error={errors.reason?.message}
        {...register("reason")}
      />
    </form>
  );
}

/**
 * <ChangeRateModal open onClose currentRate latestEffectiveFrom onSubmit={(values) => ...} />
 * values: { newRate (number), effectiveFrom, reason }
 */
export default function ChangeRateModal({ open, onClose, currentRate, latestEffectiveFrom, onSubmit }) {
  const minDate = addDaysISO(latestEffectiveFrom, 1);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Change Daily Rate"
      description="Every change is saved in the rate history."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form={FORM_ID}>
            Save New Rate
          </Button>
        </>
      }
    >
      <ChangeRateForm currentRate={currentRate} minDate={minDate} onSubmit={onSubmit} />
    </Modal>
  );
}
