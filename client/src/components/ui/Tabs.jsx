import { cn } from "../../utils/cn";

/**
 * Controlled tabs. Render the panel yourself based on `value`.
 * <Tabs tabs={[{ id: "all", label: "All", count: 48 }]} value={tab} onChange={setTab} />
 * variant: underline | pills
 */
export default function Tabs({ tabs, value, onChange, variant = "underline", fullWidth = false, className }) {
  const onKeyDown = (e, index) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const next = (index + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    onChange?.(tabs[next].id);
    e.currentTarget.parentElement?.children[next]?.focus();
  };

  const pills = variant === "pills";

  return (
    <div
      role="tablist"
      className={cn(
        "flex overflow-x-auto",
        pills ? "w-fit max-w-full gap-1 rounded-lg bg-background p-1" : "border-b border-border",
        fullWidth && "w-full",
        className
      )}
    >
      {tabs.map((tab, index) => {
        const active = tab.id === value;
        const Icon = tab.icon;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange?.(tab.id)}
            onKeyDown={(e) => onKeyDown(e, index)}
            className={cn(
              "inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-medium transition-colors",
              fullWidth && "flex-1",
              pills
                ? cn("rounded-md px-3 py-1.5", active ? "bg-surface text-fg shadow-card" : "text-fg-muted hover:text-fg")
                : cn(
                    "-mb-px border-b-2 px-4 py-2.5",
                    active
                      ? "border-primary text-primary"
                      : "border-transparent text-fg-muted hover:text-fg"
                  )
            )}
          >
            {Icon && <Icon className="h-4 w-4" aria-hidden="true" />}
            {tab.label}
            {tab.count !== undefined && (
              <span
                className={cn(
                  "rounded-full px-1.5 py-0.5 text-[11px] leading-none",
                  active ? "bg-primary-soft text-primary" : "bg-background text-fg-muted"
                )}
              >
                {tab.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
