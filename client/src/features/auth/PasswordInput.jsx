import { forwardRef, useId, useState } from "react";
import { Eye, EyeOff, Lock } from "lucide-react";
import FormField from "../../components/ui/FormField";
import { fieldBase, fieldState } from "../../components/ui/fieldStyles";
import { cn } from "../../utils/cn";

/** Password field with a show/hide button. Works with react-hook-form's register(), like the shared <Input>. */
const PasswordInput = forwardRef(function PasswordInput({ label, error, id, className, ...props }, ref) {
  const autoId = useId();
  const inputId = id || autoId;
  const [visible, setVisible] = useState(false);

  return (
    <FormField id={inputId} label={label} error={error}>
      <div className="relative">
        <Lock aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-muted" />
        <input
          ref={ref}
          id={inputId}
          type={visible ? "text" : "password"}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${inputId}-error` : undefined}
          className={cn(fieldBase, fieldState(error), "h-11 pl-9 pr-11 sm:h-10", className)}
          {...props}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? "Hide password" : "Show password"}
          aria-pressed={visible}
          className="absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-md text-fg-muted hover:bg-background hover:text-fg"
        >
          {visible ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
        </button>
      </div>
    </FormField>
  );
});

export default PasswordInput;
