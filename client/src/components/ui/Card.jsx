import { cn } from "../../utils/cn";

/**
 * <Card>
 *   <CardHeader title="Weekly Labour Attendance" icon={Calendar} action={<Button size="sm">...</Button>} />
 *   <CardBody>...</CardBody>
 * </Card>
 */
export function Card({ className, children, ...props }) {
  return (
    <div className={cn("rounded-xl border border-border bg-surface shadow-card", className)} {...props}>
      {children}
    </div>
  );
}

export function CardHeader({ title, subtitle, icon: Icon, action, className }) {
  return (
    <div className={cn("flex items-center justify-between gap-3 px-4 pt-4 sm:px-5 sm:pt-5", className)}>
      <div className="flex min-w-0 items-center gap-2.5">
        {Icon && <Icon className="h-5 w-5 shrink-0 text-secondary" aria-hidden="true" />}
        <div className="min-w-0">
          <h3 className="type-card-heading truncate">{title}</h3>
          {subtitle && <p className="type-small mt-0.5">{subtitle}</p>}
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function CardBody({ className, children }) {
  return <div className={cn("p-4 sm:p-5", className)}>{children}</div>;
}

export function CardFooter({ className, children }) {
  return (
    <div className={cn("flex items-center justify-end gap-2 border-t border-border px-4 py-3 sm:px-5", className)}>
      {children}
    </div>
  );
}

export default Card;
