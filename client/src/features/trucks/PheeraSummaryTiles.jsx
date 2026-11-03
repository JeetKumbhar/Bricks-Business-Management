import { formatQuantity, UNITS } from "../../utils/materials";

/**
 * Pheera count, bricks and tonnes. Bricks and tonnes are separate tiles because they are different units
 * and are never added together.
 */
export default function PheeraSummaryTiles({ summary, heading }) {
  const tiles = [
    { label: "Pheera", value: summary.count, caption: "trips" },
    { label: "Bricks", value: formatQuantity(summary.bricks, UNITS.BRICKS), caption: `${summary.brickCount} Pheera` },
    { label: "Tonnes", value: formatQuantity(summary.tonnes, UNITS.TONNES), caption: `${summary.tonneCount} Pheera` },
  ];
  return (
    <section aria-label={heading ?? "Pheera totals"}>
      {heading && <h3 className="mb-2 text-sm font-semibold text-fg-muted">{heading}</h3>}
      <div className="grid grid-cols-3 gap-3 sm:gap-4">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-xl border border-border bg-surface p-3 sm:p-4">
            <p className="text-xs font-medium text-fg-muted sm:text-sm">{t.label}</p>
            <p className="mt-1 truncate text-xl font-bold leading-none sm:text-3xl">{t.value}</p>
            <p className="mt-1 text-[11px] text-fg-muted sm:text-xs">{t.caption}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
