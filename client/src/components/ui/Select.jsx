import { forwardRef, useId } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "../../utils/cn";
import FormField from "./FormField";
import { fieldBase, fieldState } from "./fieldStyles";

/**
 * <Select label="Status" options={[{ value: "ACTIVE", label: "Active" }]} placeholder="All" />
 * Or pass <option> children instead of `options`.
 */
const Select = forwardRef(function Select(
  { label, error, hint, required, options, placeholder, id, className, wrapperClassName, children, ...props },
  ref
) {
  const autoId = useId();
  const selectId = id || autoId;

  return (
    <FormField id={selectId} label={label} required={required} hint={hint} error={error} className={wrapperClassName}>
      <div className="relative">
        <select
          ref={ref}
          id={selectId}
          aria-required={required || undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${selectId}-error` : hint ? `${selectId}-hint` : undefined}
          className={cn(fieldBase, fieldState(error), "h-11 appearance-none pr-9 sm:h-10", className)}
          {...props}
        >
          {placeholder !== undefined && <option value="">{placeholder}</option>}
          {options
            ? options.map((o) => (
                <option key={o.value} value={o.value} disabled={o.disabled}>
                  {o.label}
                </option>
              ))
            : children}
        </select>
        <ChevronDown
          aria-hidden="true"
          className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-muted"
        />
      </div>
    </FormField>
  );
});

export default Select;
