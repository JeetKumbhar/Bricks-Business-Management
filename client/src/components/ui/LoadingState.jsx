import { Loader2 } from "lucide-react";
import { cn } from "../../utils/cn";

/** Placeholder block for skeleton screens: <Skeleton className="h-4 w-24" /> */
export function Skeleton({ className }) {
  return <div aria-hidden="true" className={cn("animate-pulse rounded-md bg-border/70", className)} />;
}

/** Centered spinner. <LoadingState label="Loading labour..." /> */
export default function LoadingState({ label = "Loading...", fullPage = false, className }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "flex flex-col items-center justify-center gap-3 text-fg-muted",
        fullPage ? "min-h-screen" : "py-12",
        className
      )}
    >
      <Loader2 className="h-7 w-7 animate-spin text-primary" aria-hidden="true" />
      <p className="text-sm">{label}</p>
    </div>
  );
}
