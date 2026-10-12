import { Users } from "lucide-react";
import { cn } from "../../utils/cn";
import { LABOUR_TYPES } from "../../utils/labourTypes";

const initials = (name) =>
  name
    .split(" ")
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

/** Initials for an individual worker, a "people" icon for a Patlavale family / team. */
export default function LabourAvatar({ worker, className }) {
  const isTeam = worker.labourType === LABOUR_TYPES.PATLAVALE;
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full font-semibold",
        isTeam ? "bg-warning-soft text-amber-700" : "bg-primary-soft text-primary",
        className ?? "h-9 w-9 text-xs"
      )}
    >
      {isTeam ? <Users className="h-1/2 w-1/2" aria-hidden="true" /> : initials(worker.name)}
    </span>
  );
}
