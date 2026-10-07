import { cn } from "../../utils/cn";

const variants = {
  success: { box: "bg-success-soft text-green-700", dot: "bg-success" },
  warning: { box: "bg-warning-soft text-amber-700", dot: "bg-warning" },
  danger: { box: "bg-danger-soft text-red-600", dot: "bg-danger" },
  info: { box: "bg-primary-soft text-primary", dot: "bg-primary" },
  purple: { box: "bg-violet-100 text-violet-700", dot: "bg-violet-500" },
  neutral: { box: "bg-background text-fg-muted ring-1 ring-inset ring-border", dot: "bg-fg-muted" },
};

const sizes = {
  sm: "px-2 py-0.5 text-[11px]",
  md: "px-2.5 py-1 text-xs",
};

/** <Badge variant="success">Active</Badge>  <Badge variant="danger" dot>Absent</Badge> */
export default function Badge({ variant = "neutral", size = "md", dot = false, className, children }) {
  const v = variants[variant] ?? variants.neutral;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full font-medium",
        v.box,
        sizes[size],
        className
      )}
    >
      {dot && <span className={cn("h-1.5 w-1.5 rounded-full", v.dot)} aria-hidden="true" />}
      {children}
    </span>
  );
}
