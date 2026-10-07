import { forwardRef, useId } from "react";
import { cn } from "../../utils/cn";
import FormField from "./FormField";
import { fieldBase, fieldState } from "./fieldStyles";

/**
 * Native date input (best mobile UX, no extra dependency).
 * Value format is "YYYY-MM-DD". Works with register() and with controlled value/onChange(event).
 * <DatePicker label="Joining date" max="2026-12-31" {...register("joiningDate")} />
 */
const DatePicker = forwardRef(function DatePicker(
  { label, error, hint, required, id, min, max, className, wrapperClassName, ...props },
  ref
) {
  const autoId = useId();
  const dateId = id || autoId;

  return (
    <FormField id={dateId} label={label} required={required} hint={hint} error={error} className={wrapperClassName}>
      <input
        ref={ref}
        id={dateId}
        type="date"
        min={min}
        max={max}
        aria-required={required || undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${dateId}-error` : hint ? `${dateId}-hint` : undefined}
        className={cn(fieldBase, fieldState(error), "h-10 min-w-0", className)}
        {...props}
      />
    </FormField>
  );
});

export default DatePicker;
