import { Plus } from "lucide-react";
import { Badge, Button, Modal } from "../../components/ui";
import { formatCurrency } from "../../utils/formatCurrency";
import { formatDate } from "../../utils/formatDate";
import { STOP_REASON_LABELS, TRUCK_STATUS_META } from "../../utils/truckStatus";

const describeHistory = (h) => {
  if (h.kind === "CREATED") return h.note || "Truck added";
  if (h.kind === "DRIVER") return h.note;
  const from = TRUCK_STATUS_META[h.from]?.label ?? "-";
  const to = TRUCK_STATUS_META[h.to].label;
  const reason = h.reason ? ` (${STOP_REASON_LABELS[h.reason]})` : "";
  return `${from} to ${to}${reason}`;
};

/** Status history (every change, newest first) and maintenance records of one truck. */
export default function TruckDetailsModal({ truck, history, maintenance, onClose, onAddService }) {
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
            <ol className="divide-y divide-border rounded-lg border border-border">
              {history.map((h) => (
                <li key={h.id} className="px-3 py-2.5">
                  <p className="text-sm font-medium">{describeHistory(h)}</p>
                  {h.kind === "STATUS" && h.note && <p className="type-small">{h.note}</p>}
                  <p className="type-small">
                    {formatDate(h.changedAt)} - {h.changedBy}
                  </p>
                </li>
              ))}
            </ol>
          </section>

          <section>
            <div className="mb-2 flex items-center justify-between gap-3">
              <h3 className="type-card-heading">Maintenance</h3>
              <Button variant="outline" size="sm" leftIcon={Plus} onClick={() => onAddService(truck)}>
                Add service record
              </Button>
            </div>
            {maintenance.length === 0 ? (
              <p className="type-small">No maintenance recorded yet.</p>
            ) : (
              <ul className="divide-y divide-border rounded-lg border border-border">
                {maintenance.map((m) => (
                  <li key={m.id} className="flex items-start justify-between gap-3 px-3 py-2.5">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{m.description}</p>
                      <p className="type-small">
                        {formatDate(m.date)}
                        {m.status === "COMPLETED" && m.completedDate && m.completedDate !== m.date ? ` - done ${formatDate(m.completedDate)}` : ""}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <Badge variant={m.status === "OPEN" ? "warning" : "success"} size="sm">
                        {m.status === "OPEN" ? "Open" : "Completed"}
                      </Badge>
                      <p className="mt-1 text-sm font-semibold">{m.cost != null ? formatCurrency(m.cost) : "Cost not set"}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <p className="type-small">Trucks are separate from labour earnings: nothing here changes anyone's account.</p>
        </div>
      )}
    </Modal>
  );
}
