import { useState } from "react";
import { Button, Modal, Textarea } from "../../components/ui";
import { validateArchiveReason } from "./customerView";

/**
 * Archive a customer (never a permanent delete: it can be restored). A reason is required. The server's refusal (for example "Pheera of this
 * customer are in a draft bill") is shown here as it is, and the reason stays typed.
 */
function ArchiveBody({ customer, submitting, error, onSubmit }) {
  const [reason, setReason] = useState("");
  const [touched, setTouched] = useState(false);
  const problem = validateArchiveReason(reason);
  return (
    <form
      id="archive-customer-form"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        setTouched(true);
        if (!problem) onSubmit(customer.id, reason.trim());
      }}
      className="space-y-4"
    >
      <p className="text-sm">
        <strong>{customer.name}</strong> will be hidden from new Pheera and invoices. Old records keep this customer. You can restore it later.
      </p>
      <fieldset disabled={submitting} className="m-0 min-w-0 border-0 p-0">
        <Textarea
          label="Reason"
          required
          rows={2}
          maxLength={200}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          error={touched && problem ? problem : undefined}
        />
      </fieldset>
      {error && (
        <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2.5 text-sm text-danger">
          Not archived: {error}
        </p>
      )}
    </form>
  );
}

export default function ArchiveCustomerModal({ customer, submitting = false, error = "", onClose, onSubmit }) {
  return (
    <Modal
      open={Boolean(customer)}
      onClose={onClose}
      title="Archive customer"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button type="submit" form="archive-customer-form" variant="danger" loading={submitting} disabled={submitting}>
            {submitting ? "Archiving..." : "Archive"}
          </Button>
        </>
      }
    >
      {customer && <ArchiveBody key={customer.id} customer={customer} submitting={submitting} error={error} onSubmit={onSubmit} />}
    </Modal>
  );
}
