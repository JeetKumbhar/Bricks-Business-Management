import { cn } from "../../../utils/cn";

/** Summary tiles for a daily work sheet. tiles: [{ label, value, sub }]. Shared by the Maapvali and Patlavale pages. */
export default function DailySummaryTiles({ tiles }) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" role="status" aria-live="polite">
      {tiles.map((t) => (
        <div key={t.label} className={cn("rounded-xl border border-border bg-surface p-3.5 sm:p-4")}>
          <p className="text-xs text-fg-muted sm:text-sm">{t.label}</p>
          <p className="mt-1 truncate text-xl font-bold sm:text-2xl">{t.value}</p>
          {t.sub && <p className="type-small mt-0.5">{t.sub}</p>}
        </div>
      ))}
    </div>
  );
}
