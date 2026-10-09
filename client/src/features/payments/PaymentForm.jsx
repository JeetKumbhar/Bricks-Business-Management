import { useMemo } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertTriangle, IndianRupee } from "lucide-react";
import { DatePicker, Input, Textarea } from "../../components/ui";
import { cn } from "../../utils/cn";
import { formatCurrency } from "../../utils/formatCurrency";
import { toISODate } from "../../utils/formatDate";
import { PAYMENT_TYPES } from "../../utils/paymentTypes";
import { makePaymentSchema } from "../../validators/paymentValidator";
import LabourPicker from "./LabourPicker";
import PaymentTypeSelect from "./PaymentTypeSelect";

const QUICK_AMOUNTS = [500, 1000, 2000, 5000];

/**
 * Fields: Labour, Payment Type, Amount, Date, Note  (+ "Reason for correction" when editing).
 * Submit from a modal footer with <Button type="submit" form={formId}>.
 * In edit mode the labour is locked: a payment given to the wrong labour is deleted and re-entered.
 */
export default function PaymentForm({ formId, payment, labours, onSubmit }) {
  const isEdit = Boolean(payment);
  const schema = useMemo(() => makePaymentSchema({ isEdit }), [isEdit]);

  const {
    register,
    handleSubmit,
    control,
    watch,
    setValue,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(schema),
    defaultValues: isEdit
      ? {
          labourId: payment.labourId,
          type: payment.type,
          amount: String(payment.amount),
          date: payment.date,
          note: payment.note ?? "",
          reason: "",
        }
      : { labourId: "", type: PAYMENT_TYPES.SALARY_PAYMENT, amount: "", date: toISODate(), note: "", reason: "" },
  });

  const [labourId, type, amountText] = watch(["labourId", "type", "amount"]);
  const labour = labours.find((l) => l.id === labourId);
  const amount = Number(amountText) > 0 ? Number(amountText) : 0;

  // When editing, this payment is already part of the labour's balance, so add it back first.
  const balanceBefore = labour ? labour.balance + (isEdit ? payment.amount : 0) : 0;
  const balanceAfter = balanceBefore - amount;
  const overpaid = Boolean(labour) && amount > 0 && balanceAfter < 0;

  return (
    <form id={formId} onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
      <Controller
        name="labourId"
        control={control}
        render={({ field }) => (
          <LabourPicker
            labours={labours}
            value={field.value}
            onChange={field.onChange}
            error={errors.labourId?.message}
            disabled={isEdit}
          />
        )}
      />

      {labour && (
        <div className={cn("rounded-lg px-4 py-3 text-sm", overpaid ? "bg-danger-soft" : "bg-background")}>
          <div className="flex items-center justify-between gap-3">
            <span className="text-fg-muted">{isEdit ? "Balance before this payment" : "Current balance"}</span>
            <span className={cn("font-semibold", balanceBefore < 0 && "text-danger")}>{formatCurrency(balanceBefore)}</span>
          </div>
          {amount > 0 && (
            <div className="mt-1 flex items-center justify-between gap-3">
              <span className="text-fg-muted">After this payment</span>
              <span className={cn("font-semibold", balanceAfter < 0 && "text-danger")}>{formatCurrency(balanceAfter)}</span>
            </div>
          )}
          {overpaid && (
            <p className="mt-2 flex items-start gap-1.5 text-xs font-medium text-danger">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              This pays more than the labour has earned. The balance will show in red.
            </p>
          )}
        </div>
      )}

      <Controller
        name="type"
        control={control}
        render={({ field }) => <PaymentTypeSelect value={field.value} onChange={field.onChange} error={errors.type?.message} />}
      />

      <div className="space-y-2">
        <Input
          label="Amount"
          required
          type="number"
          inputMode="numeric"
          min="1"
          leftIcon={IndianRupee}
          placeholder="0"
          error={errors.amount?.message}
          {...register("amount")}
        />
        <div className="flex flex-wrap gap-2">
          {QUICK_AMOUNTS.map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setValue("amount", String(value), { shouldValidate: true, shouldDirty: true })}
              className="h-9 rounded-full border border-border bg-surface px-3 text-sm font-medium text-fg hover:bg-background"
            >
              {formatCurrency(value)}
            </button>
          ))}
        </div>
      </div>

      <DatePicker label="Date" required max={toISODate()} error={errors.date?.message} {...register("date")} />

      <Textarea
        label="Note"
        required={type === PAYMENT_TYPES.OTHER}
        rows={2}
        placeholder={type === PAYMENT_TYPES.OTHER ? "What is this payment for?" : "Optional"}
        error={errors.note?.message}
        {...register("note")}
      />

      {isEdit && (
        <Textarea
          label="Reason for correction"
          required
          rows={2}
          placeholder="Why is this payment being changed?"
          hint="Saved in the audit log."
          error={errors.reason?.message}
          {...register("reason")}
        />
      )}
    </form>
  );
}
