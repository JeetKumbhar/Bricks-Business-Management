import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "../../utils/cn";

function getPageItems(page, pageCount) {
  if (pageCount <= 7) return Array.from({ length: pageCount }, (_, i) => i + 1);

  const items = [1];
  const start = Math.max(2, page - 1);
  const end = Math.min(pageCount - 1, page + 1);
  if (start > 2) items.push("gap-start");
  for (let i = start; i <= end; i += 1) items.push(i);
  if (end < pageCount - 1) items.push("gap-end");
  items.push(pageCount);
  return items;
}

const buttonBase =
  "inline-flex h-11 min-w-11 items-center justify-center rounded-lg border px-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 sm:h-9 sm:min-w-9";

/**
 * Phones: [<]  Page 2 of 5  [>]   (big tap targets)
 * sm+   : [<] 1 2 3 ... 5 [>]
 */
export default function Pagination({ page, pageCount, onPageChange, className }) {
  if (pageCount <= 1) return null;

  return (
    <nav aria-label="Pagination" className={cn("flex items-center justify-between gap-1.5 sm:justify-end", className)}>
      <button
        type="button"
        aria-label="Previous page"
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
        className={cn(buttonBase, "border-border bg-surface text-fg-muted hover:bg-background")}
      >
        <ChevronLeft className="h-4 w-4" />
      </button>

      <span className="text-sm text-fg-muted sm:hidden" aria-live="polite">
        Page {page} of {pageCount}
      </span>

      <div className="hidden items-center gap-1.5 sm:flex">
        {getPageItems(page, pageCount).map((item) =>
          typeof item === "string" ? (
            <span key={item} className="px-1 text-fg-muted" aria-hidden="true">
              ...
            </span>
          ) : (
            <button
              key={item}
              type="button"
              aria-label={`Page ${item}`}
              aria-current={item === page ? "page" : undefined}
              onClick={() => onPageChange(item)}
              className={cn(
                buttonBase,
                item === page
                  ? "border-primary bg-primary text-white"
                  : "border-border bg-surface text-fg hover:bg-background"
              )}
            >
              {item}
            </button>
          )
        )}
      </div>

      <button
        type="button"
        aria-label="Next page"
        disabled={page >= pageCount}
        onClick={() => onPageChange(page + 1)}
        className={cn(buttonBase, "border-border bg-surface text-fg-muted hover:bg-background")}
      >
        <ChevronRight className="h-4 w-4" />
      </button>
    </nav>
  );
}
