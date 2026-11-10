import { Button } from "../../components/ui";

/** Shown inside a truck window when a save's outcome is unknown (connection lost). Saving is blocked until it is settled. */
export default function UnconfirmedNotice({ message, onRecheck, busy }) {
  return (
    <div role="alert" className="mb-4 space-y-2 rounded-lg border border-warning bg-warning-soft px-3 py-2.5 text-sm text-amber-800">
      <p className="font-semibold">Not confirmed</p>
      <p>{message}</p>
      <Button size="sm" variant="outline" onClick={onRecheck} loading={busy} disabled={busy}>
        Check again
      </Button>
    </div>
  );
}
