import { cn } from "../../utils/cn";
import { LABOUR_TYPE_META, LABOUR_TYPE_OPTIONS } from "../../utils/labourTypes";

/** Bigari | Maapvali | Patlavale, with a one-line explanation of the selected type. */
export default function LabourTypeSelect({ value, onChange }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span id="labour-type-label" className="text-sm font-medium text-fg">
        Labour Type<span className="ml-0.5 text-danger">*</span>
      </span>
      <div role="radiogroup" aria-labelledby="labour-type-label" className="grid grid-cols-3 gap-2">
        {LABOUR_TYPE_OPTIONS.map((option) => {
          const selected = value === option.value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(option.value)}
              className={cn(
                "flex h-12 items-center justify-center rounded-lg border px-1 text-sm font-semibold transition-colors",
                selected
                  ? "border-primary bg-primary-soft text-primary"
                  : "border-border bg-surface text-fg-muted hover:bg-background"
              )}
            >
              {option.label}
            </button>
          );
        })}
      </div>
      <p className="type-small">{LABOUR_TYPE_META[value].description}</p>
    </div>
  );
}
