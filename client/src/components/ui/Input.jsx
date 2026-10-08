import { forwardRef, useId } from "react";
import { cn } from "../../utils/cn";
import FormField from "./FormField";
import { fieldBase, fieldState } from "./fieldStyles";

/**
 * Works with React Hook Form: <Input label="Name" error={errors.name?.message} {...register("name")} />
 * `required` only shows the asterisk (validation is done by Zod, not the browser).
 */
const Input = forwardRef(function Input(
  { label, error, hint, required, leftIcon: LeftIcon, id, type = "text", className, wrapperClassName, ...props },
  ref
) {
  const autoId = useId();
  const inputId = id || autoId;

  return (
    <FormField id={inputId} label={label} required={required} hint={hint} error={error} className={wrapperClassName}>
      <div className="relative">
        {LeftIcon && (
          <LeftIcon
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-muted"
          />
        )}
        <input
          ref={ref}
          id={inputId}
          type={type}
          aria-required={required || undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined}
          className={cn(fieldBase, fieldState(error), "h-11 sm:h-10", LeftIcon && "pl-9", className)}
          {...props}
        />
      </div>
    </FormField>
  );
});

export default Input;
