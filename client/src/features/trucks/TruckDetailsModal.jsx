import { Badge, Button, Modal } from "../../components/ui";
import { formatDate } from "../../utils/formatDate";
import { STOP_REASON_LABELS, TRUCK_STATUS_META } from "../../utils/truckStatus";

const describeHistory = (h) => {
  if (h.kind === "CREATED") return h.note || "Truck added";
  if (h.kind === "DRIVER") return h.note || "Driver changed";
  const from = TRUCK_STATUS_META[h.from]?.label ?? "-";
  const to = TRUCK_STATUS_META[h.to]?.label ?? h.to ?? "-";
  const reason = h.reason ? ` (${STOP_REASON_LABELS[h.reason] ?? h.reason})` : "";
  return `${from} to ${to}${reason}`;
};

/**
 * Status history of one truck (every change, newest first, read from the server). `history` = { status: loading | ready | error, items, error }.
 * Maintenance / service records are not available: the server has no place to store them, so none are shown or asked for.
 */
export default function TruckDetailsModal({ truck, history, onRetry, onClose }) {
  return (
    <Modal
      open={Boolean(truck)}
      onClose={onClose}
      size="lg"
      title={truck ? `${truck.truckNumber} - History` : ""}
      description={truck?.model || undefined}
      footer={<Button onClick={onClose}>Close</Button>}
    >
      {truck && (
        <div className="space-y-6">
          <section>
            <h3 className="type-card-heading mb-2">Status history</h3>
            {history?.status === "error" ? (
              <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-danger-soft px-3 py-2.5 text-sm text-danger">
                <span>{history.error}</span>
                <Button variant="outline" size="sm" onClick={onRetry}>
                  Try again
                </Button>
              </div>
            ) : history?.status !== "ready" ? (
              <p className="type-small" aria-live="polite">
                Loading history...
              </p>
            ) : history.items.length === 0 ? (
              <p className="type-small">No history recorded.</p>
            ) : (
              <ol className="divide-y divide-border rounded-lg border border-border">
                {history.items.map((h) => (
                  <li key={h.id} className="px-3 py-2.5">
                    <p className="text-sm font-medium">{describeHistory(h)}</p>
                    {h.kind === "STATUS" && h.note && <p className="type-small">{h.note}</p>}
                    <p className="type-small">
                      {formatDate(h.changedAt)}
                      {h.changedBy ? ` - ${h.changedBy}` : ""}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </section>

          <section>
            <div className="mb-2 flex items-center gap-2">
              <h3 className="type-card-heading">Maintenance</h3>
              <Badge variant="neutral" size="sm">
                Not available yet
              </Badge>
            </div>
            <p className="type-small">Maintenance and service records, and their costs, cannot be saved yet. Nothing is shown here so no record looks saved when it is not.</p>
          </section>
          <p className="type-small">Trucks are separate from labour earnings: nothing here changes anyone&apos;s account.</p>
        </div>
      )}
    </Modal>
  );
}
