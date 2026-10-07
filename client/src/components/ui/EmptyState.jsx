import { Inbox } from "lucide-react";
import { cn } from "../../utils/cn";

/** <EmptyState title="No labour found" description="Try a different search." action={<Button>Add Labour</Button>} /> */
export default function EmptyState({ icon: Icon = Inbox, title = "Nothing here yet", description, action, className }) {
  return (
    <div className={cn("flex flex-col items-center justify-center px-4 py-12 text-center", className)}>
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary-soft text-primary">
        <Icon className="h-7 w-7" aria-hidden="true" />
      </div>
      <h3 className="type-card-heading">{title}</h3>
      {description && <p className="type-small mt-1 max-w-sm">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
