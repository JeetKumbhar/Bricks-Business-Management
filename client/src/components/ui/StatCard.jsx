import { ArrowRight } from "lucide-react";
import { cn } from "../../utils/cn";

const palette = {
  blue: { solid: "bg-blue-500", soft: "bg-blue-50 border-blue-100", icon: "bg-blue-100 text-blue-600", link: "text-blue-600" },
  green: { solid: "bg-green-500", soft: "bg-green-50 border-green-100", icon: "bg-green-100 text-green-600", link: "text-green-600" },
  yellow: { solid: "bg-amber-500", soft: "bg-amber-50 border-amber-100", icon: "bg-amber-100 text-amber-600", link: "text-amber-600" },
  red: { solid: "bg-red-500", soft: "bg-red-50 border-red-100", icon: "bg-red-100 text-red-600", link: "text-red-600" },
  purple: { solid: "bg-violet-500", soft: "bg-violet-50 border-violet-100", icon: "bg-violet-100 text-violet-600", link: "text-violet-600" },
};

/**
 * Summary tile. Phones: compact stacked layout (icon above value) so two fit per row.
 * sm and up: icon on the left, text on the right.
 *
 * <StatCard title="Total Labour" value={48} icon={Users} color="blue" actionLabel="View All" onAction={...} />
 * color: blue | green | yellow | red | purple     variant: solid | soft
 */
export default function StatCard({
  title,
  value,
  icon: Icon,
  color = "blue",
  variant = "solid",
  actionLabel,
  onAction,
  className,
}) {
  const c = palette[color] ?? palette.blue;
  const solid = variant === "solid";

  return (
    <div
      className={cn(
        "flex flex-col items-start gap-2.5 rounded-xl p-3.5 shadow-card sm:flex-row sm:items-center sm:gap-4 sm:p-5",
        solid ? [c.solid, "text-white"] : ["border", c.soft, "text-fg"],
        className
      )}
    >
      <div
        className={cn(
          "flex h-10 w-10 shrink-0 items-center justify-center rounded-full sm:h-12 sm:w-12",
          solid ? "bg-white/20 text-white" : c.icon
        )}
      >
        {Icon && <Icon className="h-5 w-5 sm:h-6 sm:w-6" aria-hidden="true" />}
      </div>

      <div className="min-w-0 max-w-full">
        <p className={cn("text-xs sm:text-sm", solid ? "text-white/90" : "text-fg-muted")}>{title}</p>
        <p className="truncate text-2xl font-bold leading-tight sm:text-3xl">{value}</p>
        {actionLabel && (
          <button
            type="button"
            onClick={onAction}
            className={cn(
              "mt-0.5 inline-flex items-center gap-1 py-1 text-xs font-medium sm:text-sm",
              solid ? "text-white/90 hover:text-white" : c.link
            )}
          >
            {actionLabel}
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  );
}
