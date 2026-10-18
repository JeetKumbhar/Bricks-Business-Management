import { cn } from "../../utils/cn";
import { TRUCK_STATUS } from "../../utils/truckStatus";

const tiles = [
  { id: "ALL", label: "Total", key: "total", style: "border-border bg-surface text-fg" },
  { id: TRUCK_STATUS.WORKING, label: "Working", key: "working", style: "border-green-100 bg-green-50 text-green-700" },
  { id: TRUCK_STATUS.STOPPED, label: "Stopped", key: "stopped", style: "border-red-100 bg-red-50 text-red-600" },
  { id: TRUCK_STATUS.MAINTENANCE, label: "Maintenance", key: "maintenance", style: "border-amber-100 bg-amber-50 text-amber-700" },
];

/** Truck counts by status. Tap a tile to filter the list. */
export default function TruckSummaryTiles({ summary, status, onSelect }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
      {tiles.map((t) => (
        <button
          key={t.id}
          type="button"
          aria-pressed={status === t.id}
          onClick={() => onSelect(status === t.id ? "ALL" : t.id)}
          className={cn("rounded-xl border p-3.5 text-left sm:p-4", t.style, status === t.id && "ring-2 ring-primary")}
        >
          <p className="text-xs font-medium sm:text-sm">{t.label}</p>
          <p className="mt-1 text-2xl font-bold leading-none text-fg sm:text-3xl">{summary[t.key]}</p>
        </button>
      ))}
    </div>
  );
}
