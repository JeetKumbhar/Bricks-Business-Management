import { cn } from "../../utils/cn";
import { PAYMENT_TYPES } from "../../utils/paymentTypes";

const options = [
  { value: PAYMENT_TYPES.BOOKING_ADVANCE, label: "Booking Advance" },
  { value: PAYMENT_TYPES.SALARY_PAYMENT, label: "Salary Payment" },
  { value: PAYMENT_TYPES.OTHER, label: "Other" },
];

/** Three big tap targets: Booking Advance | Salary Payment | Other */
export default function PaymentTypeSelect({ value, onChange, error }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span id="payment-type-label" className="text-sm font-medium text-fg">
        Payment Type<span className="ml-0.5 text-danger">*</span>
      </span>
      <div role="radiogroup" aria-labelledby="payment-type-label" className="grid grid-cols-3 gap-2">
        {options.map((o) => {
          const selected = value === o.value;
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(o.value)}
              className={cn(
                "flex h-14 items-center justify-center rounded-lg border px-2 text-center text-sm font-semibold leading-tight transition-colors sm:h-12",
                selected
                  ? "border-primary bg-primary-soft text-primary"
                  : "border-border bg-surface text-fg-muted hover:bg-background"
              )}
            >
              {o.label}
            </button>
          );
        })}
      </div>
      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
