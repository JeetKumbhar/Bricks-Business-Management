import { Search, X } from "lucide-react";
import { cn } from "../../utils/cn";
import { fieldBase, fieldState } from "./fieldStyles";

/**
 * Controlled search box. onChange receives the string value (not the event).
 * <SearchInput value={q} onChange={setQ} placeholder="Search by name, ID or mobile number..." />
 */
export default function SearchInput({ value = "", onChange, placeholder = "Search...", className, ...props }) {
  return (
    <div className={cn("relative", className)}>
      <Search
        aria-hidden="true"
        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-muted"
      />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className={cn(fieldBase, fieldState(false), "h-11 pl-9 pr-9 sm:h-10")}
        {...props}
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange?.("")}
          aria-label="Clear search"
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-fg-muted hover:bg-background hover:text-fg"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
