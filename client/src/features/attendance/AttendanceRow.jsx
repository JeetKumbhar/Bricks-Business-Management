import { memo } from "react";
import { Check, Clock, X } from "lucide-react";
import { Badge } from "../../components/ui";
import { cn } from "../../utils/cn";
import { LABOUR_STATUS } from "../../utils/labourStatus";

const options = [
  { status: "PRESENT", label: "Present", icon: Check, on: "border-success bg-success text-white" },
  { status: "HALF_DAY", label: "Half Day", icon: Clock, on: "border-amber-400 bg-amber-400 text-fg" },
  { status: "ABSENT", label: "Absent", icon: X, on: "border-danger bg-danger text-white" },
];

const accent = {
  PRESENT: "border-l-success",
  HALF_DAY: "border-l-amber-400",
  ABSENT: "border-l-danger",
};

/**
 * One labour: Name | Present | Half Day | Absent
 * Phones: name on top, three big tap buttons below. md+: everything on one line.
 */
function AttendanceRow({ labour, status, onChange }) {
  return (
    <li
      className={cn(
        "flex flex-col gap-3 rounded-xl border border-l-4 border-border bg-surface p-3 md:flex-row md:items-center md:justify-between md:p-4",
        status ? accent[status] : "border-l-border"
      )}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <p className="truncate text-base font-semibold">{labour.name}</p>
          {labour.status === LABOUR_STATUS.INACTIVE && (
            <Badge variant="danger" size="sm">
              Inactive
            </Badge>
          )}
        </div>
        <p className="type-small">
          {labour.id} - {labour.village}
        </p>
      </div>

      <div role="radiogroup" aria-label={`Attendance for ${labour.name}`} className="grid grid-cols-3 gap-2 md:w-80">
        {options.map(({ status: value, label, icon: Icon, on }) => {
          const selected = status === value;
          return (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(labour.id, value)}
              className={cn(
                "flex h-12 items-center justify-center gap-1.5 rounded-lg border text-sm font-semibold transition-colors active:scale-[0.97] md:h-10",
                selected ? on : "border-border bg-surface text-fg-muted hover:bg-background"
              )}
            >
              <Icon className="h-4 w-4" aria-hidden="true" />
              {label}
            </button>
          );
        })}
      </div>
    </li>
  );
}

export default memo(AttendanceRow);
