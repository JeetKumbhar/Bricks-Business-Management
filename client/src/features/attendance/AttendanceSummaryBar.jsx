import { cn } from "../../utils/cn";

const items = [
  { key: "present", label: "Present", style: "bg-green-50 text-green-700" },
  { key: "halfDay", label: "Half Day", style: "bg-amber-50 text-amber-700" },
  { key: "absent", label: "Absent", style: "bg-red-50 text-red-600" },
  { key: "unmarked", label: "Not marked", style: "border border-border bg-surface text-fg-muted" },
];

/** Live counts. Sticks under the app header so it stays visible while scrolling the list. */
export default function AttendanceSummaryBar({ counts }) {
  return (
    <div className="sticky top-16 z-20 -mx-4 bg-background px-4 py-2 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
      <div className="grid grid-cols-4 gap-2" role="status" aria-live="polite">
        {items.map((item) => (
          <div key={item.key} className={cn("rounded-lg px-1.5 py-2 text-center", item.style)}>
            <p className="text-xl font-bold leading-none">{counts[item.key]}</p>
            <p className="mt-1 text-[11px] font-medium leading-none">{item.label}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
