
import { Button, Modal } from "../../components/ui";
import { formatCurrency } from "../../utils/formatCurrency";
import { formatDate } from "../../utils/formatDate";
import { PAYMENT_TYPE_META } from "../../utils/paymentTypes";

const describe = (v) =>
  `${formatCurrency(v.amount)} - ${PAYMENT_TYPE_META[v.type].label} - ${formatDate(v.date)}${v.note ? ` - ${v.note}` : ""}`;

/** What a corrected payment looked like before each change, and why it was changed. */
export default function PaymentRevisionsModal({ payment, onClose }) {
  const revisions = payment ? [...(payment.revisions ?? [])].reverse() : [];

  return (
    <Modal
      open={Boolean(payment)}
      onClose={onClose}
      title="Changes to this payment"
      description={payment ? `${payment.labourName} (${payment.labourId})` : undefined}
      footer={<Button onClick={onClose}>Close</Button>}
    >
      {payment && (
        <div className="space-y-4">
          <div className="rounded-lg bg-primary-soft p-3 text-sm">
            <p className="text-xs font-medium text-fg-muted">Now</p>
            <p className="mt-0.5 font-semibold">{describe(payment)}</p>
          </div>

          <ol className="space-y-3">
            {revisions.map((r, index) => (
              <li key={`${r.changedAt}-${index}`} className="rounded-lg border border-border p-3 text-sm">
                <p className="type-small">
                  Changed on {formatDate(r.changedAt)} by {r.changedBy}
                </p>
                <p className="mt-1.5 text-fg-muted">Before:</p>
                <p className="font-medium">{describe(r.before)}</p>
                <p className="mt-1.5 text-fg-muted">Reason:</p>
                <p className="font-medium">{r.reason}</p>
              </li>
            ))}
          </ol>
        </div>
      )}
    </Modal>
  );
}
