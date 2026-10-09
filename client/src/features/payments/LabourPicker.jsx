import { useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { Badge, SearchInput } from "../../components/ui";
import { fieldBase, fieldState } from "../../components/ui/fieldStyles";
import { cn } from "../../utils/cn";
import { formatCurrency } from "../../utils/formatCurrency";
import { LABOUR_STATUS } from "../../utils/labourStatus";
import { filterLabours } from "../labours/labourSelectors";

/**
 * Searchable labour field that expands inline (works well inside a phone bottom sheet,
 * unlike a native <select> with 48 options).
 */
export default function LabourPicker({ labours, value, onChange, error, disabled = false }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const selected = labours.find((l) => l.id === value);

  // Active labour first, then inactive; each group by ID.
  const list = useMemo(() => {
    const found = filterLabours(labours, { search: query });
    return [...found].sort(
      (a, b) =>
        Number(b.status === LABOUR_STATUS.ACTIVE) - Number(a.status === LABOUR_STATUS.ACTIVE) || a.id.localeCompare(b.id)
    );
  }, [labours, query]);

  const choose = (id) => {
    onChange(id);
    setOpen(false);
    setQuery("");
  };

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-fg">
        Labour<span className="ml-0.5 text-danger">*</span>
      </span>

      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className={cn(fieldBase, fieldState(error), "flex min-h-12 items-center justify-between gap-3 py-2 text-left")}
      >
        {selected ? (
          <span className="min-w-0">
            <span className="block truncate font-medium">{selected.name}</span>
            <span className="block text-xs text-fg-muted">
              {selected.id} - {selected.village}
            </span>
          </span>
        ) : (
          <span className="text-fg-muted">Select labour</span>
        )}
        {!disabled && <ChevronDown className={cn("h-4 w-4 shrink-0 text-fg-muted transition-transform", open && "rotate-180")} aria-hidden="true" />}
      </button>

      {open && (
        <div className="rounded-lg border border-border bg-surface shadow-card">
          <div className="border-b border-border p-2">
            <SearchInput
              value={query}
              onChange={setQuery}
              placeholder="Search name, ID or mobile..."
              autoFocus={typeof window !== "undefined" && window.matchMedia("(pointer: fine)").matches}
            />
          </div>
          <ul role="listbox" aria-label="Labour" className="max-h-64 overflow-y-auto overscroll-contain p-1">
            {list.length === 0 && <li className="px-3 py-6 text-center text-sm text-fg-muted">No labour found</li>}
            {list.map((l) => (
              <li key={l.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={l.id === value}
                  onClick={() => choose(l.id)}
                  className={cn(
                    "flex w-full items-center justify-between gap-3 rounded-md px-3 py-2.5 text-left hover:bg-background",
                    l.id === value && "bg-primary-soft"
                  )}
                >
                  <span className="min-w-0">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium">{l.name}</span>
                      {l.status === LABOUR_STATUS.INACTIVE && (
                        <Badge variant="danger" size="sm">
                          Inactive
                        </Badge>
                      )}
                    </span>
                    <span className="block text-xs text-fg-muted">
                      {l.id} - {l.village}
                    </span>
                  </span>
                  <span className={cn("shrink-0 text-xs font-semibold", l.balance < 0 && "text-danger")}>
                    {formatCurrency(l.balance)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
