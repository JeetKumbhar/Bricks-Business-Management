import { forwardRef, useId } from "react";
import { cn } from "../../utils/cn";
import FormField from "./FormField";
import { fieldBase, fieldState } from "./fieldStyles";

const Textarea = forwardRef(function Textarea(
  { label, error, hint, required, id, rows = 3, className, wrapperClassName, ...props },
  ref
) {
  const autoId = useId();
  const areaId = id || autoId;

  return (
    <FormField id={areaId} label={label} required={required} hint={hint} error={error} className={wrapperClassName}>
      <textarea
        ref={ref}
        id={areaId}
        rows={rows}
        aria-required={required || undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${areaId}-error` : hint ? `${areaId}-hint` : undefined}
        className={cn(fieldBase, fieldState(error), "resize-y py-2", className)}
        {...props}
      />
    </FormField>
  );
});

export default Textarea;
