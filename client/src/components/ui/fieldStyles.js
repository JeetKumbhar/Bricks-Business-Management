// Shared look for Input / Select / Textarea / DatePicker.
export const fieldBase =
  "w-full rounded-lg border bg-surface px-3 text-sm text-fg placeholder:text-fg-muted/70 transition-colors focus:outline-none focus:ring-2 disabled:cursor-not-allowed disabled:bg-background disabled:text-fg-muted";

export const fieldState = (error) =>
  error
    ? "border-danger focus:border-danger focus:ring-danger/20"
    : "border-border focus:border-primary focus:ring-primary/20";
