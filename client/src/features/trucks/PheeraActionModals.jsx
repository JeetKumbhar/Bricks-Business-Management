import { useState } from "react";
import { Button, Input, Modal, Select, Textarea } from "../../components/ui";
import { formatDate } from "../../utils/formatDate";
import { CUSTOM_MATERIAL_MAX, MATERIAL_CHOICES, OTHER, formatWithUnit, parseQuantity, quantityRule, unitForMaterial } from "../../utils/materials";
import { customerOptionsFor } from "../customers/customerChoices";
import { correctionChanges, correctionDefaults } from "./pheeraLifecycle";

// Dialogs for Correct, Change customer and Release. Each keeps what the person typed when the server refuses, and shows the
// server's own message. `onSubmit(values)` returns the outcome of runPheeraAction ({ ok } | { ok:false, message, fieldErrors }).

const REASON_HELP = "3 to 200 characters. Kept in the Pheera's history.";
const summaryOf = (r) => `${r.registration ?? r.truckRegistration}, Pheera #${r.pheeraNumber} on ${formatDate(r.businessDate)}: ${formatWithUnit(r.quantity, r.unit)} of ${r.material} to ${r.destination}`;

const reasonError = (reason) => (reason.trim().length < 3 ? "Please give a reason (at least 3 characters)" : reason.trim().length > 200 ? "Reason is too long (200 characters at most)" : null);

function ServerMessage({ message }) {
  return message ? (
    <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
      {message}
    </p>
  ) : null;
}

function ActionShell({ title, record, formId, submitText, submitting, onClose, children }) {
  return (
    <Modal
      open={Boolean(record)}
      onClose={submitting ? () => {} : onClose}
      title={title}
      description={record ? summaryOf(record) : undefined}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button type="submit" form={formId} loading={submitting} disabled={submitting}>
            {submitText}
          </Button>
        </>
      }
    >
      {record && children}
    </Modal>
  );
}

// ---- Correct -------------------------------------------------------------------------------------------------------------------

function CorrectForm({ record, submitting, onSubmit }) {
  const [v, setV] = useState(() => correctionDefaults(record));
  const [shown, setShown] = useState(false);
  const [server, setServer] = useState({ message: null, fieldErrors: {} });
  const materialName = v.material === OTHER ? v.customName.trim() : v.material;
  const rule = quantityRule(materialName || v.material);
  const changes = correctionChanges(record, { material: materialName, destination: v.destination, quantity: v.quantity, remarks: v.remarks });
  const errors = {
    customName: v.material === OTHER && !v.customName.trim() ? "Enter the material name" : null,
    destination: !v.destination.trim() ? "Destination is required" : null,
    quantity: (() => { const q = parseQuantity(materialName || v.material, v.quantity); return q.ok ? null : q.message; })(),
    reason: reasonError(v.reason),
  };
  const set = (patch) => setV((x) => ({ ...x, ...patch }));

  const submit = async (e) => {
    e.preventDefault();
    setShown(true);
    if (Object.values(errors).some(Boolean) || Object.keys(changes).length === 0) return;
    const outcome = await onSubmit({ changes, reason: v.reason });
    if (!outcome.ok) setServer({ message: outcome.message, fieldErrors: outcome.fieldErrors ?? {} });
  };
  const fe = server.fieldErrors;
  const nothing = shown && Object.keys(changes).length === 0;

  return (
    <form id="pheera-correct-form" noValidate onSubmit={submit} className="space-y-4">
      <fieldset disabled={submitting} className="m-0 min-w-0 space-y-4 border-0 p-0">
        <Select label="Material" required value={v.material} onChange={(e) => set({ material: e.target.value })} options={MATERIAL_CHOICES.map((m) => ({ value: m, label: m }))} error={fe.material} />
        {v.material === OTHER && <Input label="Material name" required maxLength={CUSTOM_MATERIAL_MAX} value={v.customName} onChange={(e) => set({ customName: e.target.value })} error={(shown && errors.customName) || fe.customMaterialName} />}
        <Input label="Destination" required value={v.destination} onChange={(e) => set({ destination: e.target.value })} error={(shown && errors.destination) || fe.destination} />
        <Input
          label={`Quantity (${unitForMaterial(materialName || v.material)})`}
          required
          inputMode="decimal"
          value={v.quantity}
          onChange={(e) => set({ quantity: e.target.value })}
          error={(shown && errors.quantity) || fe.quantity}
          hint={materialName !== record.material ? "The material changed, so check the quantity: it is saved in the new unit." : rule.label}
        />
        <Input label="Remarks" value={v.remarks} onChange={(e) => set({ remarks: e.target.value })} error={fe.remarks} />
        <Textarea label="Reason for the correction" required rows={2} value={v.reason} onChange={(e) => set({ reason: e.target.value })} error={(shown && errors.reason) || fe.reason} hint={REASON_HELP} />
        {nothing && <p role="alert" className="text-sm text-danger">Nothing was changed. Change a field first.</p>}
        <ServerMessage message={server.message} />
      </fieldset>
    </form>
  );
}

export function CorrectPheeraModal({ record, submitting = false, onClose, onSubmit }) {
  return (
    <ActionShell title="Correct Pheera" record={record} formId="pheera-correct-form" submitText="Save correction" submitting={submitting} onClose={onClose}>
      <p className="type-small mb-3">The truck, date and Pheera number cannot be changed. The server checks the quantity for the unit.</p>
      <CorrectForm key={record?.id} record={record} submitting={submitting} onSubmit={onSubmit} />
    </ActionShell>
  );
}

// ---- Assign / change customer --------------------------------------------------------------------------------------------------

function AssignForm({ record, choices, submitting, onSubmit }) {
  const [customerId, setCustomerId] = useState("");
  const [reason, setReason] = useState("");
  const [shown, setShown] = useState(false);
  const [server, setServer] = useState({ message: null, fieldErrors: {} });
  const options = customerOptionsFor(choices).filter((o) => o.value !== record.customerId);
  const errors = { customerId: customerId ? null : "Choose a customer", reason: reasonError(reason) };

  const submit = async (e) => {
    e.preventDefault();
    setShown(true);
    if (errors.customerId || errors.reason) return;
    const outcome = await onSubmit({ customerId, reason });
    if (!outcome.ok) setServer({ message: outcome.message, fieldErrors: outcome.fieldErrors ?? {} });
  };

  return (
    <form id="pheera-assign-form" noValidate onSubmit={submit} className="space-y-4">
      <fieldset disabled={submitting} className="m-0 min-w-0 space-y-4 border-0 p-0">
        <p className="rounded-lg bg-background px-3 py-2 text-sm">
          <span className="text-fg-muted">Now: </span>
          <span className="font-medium">{record.customerName ?? "No customer (older record)"}</span>
        </p>
        <Select label="New customer" required placeholder="Choose a customer" value={customerId} onChange={(e) => setCustomerId(e.target.value)} options={options} error={(shown && errors.customerId) || server.fieldErrors.customerId} hint="Internal / No Bill Pheeras are never invoiced." />
        <Textarea label="Reason" required rows={2} value={reason} onChange={(e) => setReason(e.target.value)} error={(shown && errors.reason) || server.fieldErrors.reason} hint={REASON_HELP} />
        <ServerMessage message={server.message} />
      </fieldset>
    </form>
  );
}

export function AssignCustomerModal({ record, choices, submitting = false, onClose, onSubmit }) {
  const title = record?.customerName ? "Change customer" : "Assign customer";
  return (
    <ActionShell title={title} record={record} formId="pheera-assign-form" submitText="Save customer" submitting={submitting} onClose={onClose}>
      <AssignForm key={record?.id} record={record} choices={choices} submitting={submitting} onSubmit={onSubmit} />
    </ActionShell>
  );
}

// ---- Release -------------------------------------------------------------------------------------------------------------------

function ReleaseForm({ record, submitting, onSubmit }) {
  const [reason, setReason] = useState("");
  const [shown, setShown] = useState(false);
  const [server, setServer] = useState({ message: null });
  const error = reasonError(reason);
  const submit = async (e) => {
    e.preventDefault();
    setShown(true);
    if (error) return;
    const outcome = await onSubmit({ reason });
    if (!outcome.ok) setServer({ message: outcome.message });
  };
  return (
    <form id="pheera-release-form" noValidate onSubmit={submit} className="space-y-4">
      <fieldset disabled={submitting} className="m-0 min-w-0 space-y-4 border-0 p-0">
        <p className="text-sm">
          This Pheera was billed{record.bill?.billNumber ? ` on invoice ${record.bill.billNumber}` : ""}. It can be released only when that invoice has been cancelled. It then becomes "Not billed" again; the billing history is kept.
        </p>
        <Textarea label="Reason for releasing" required rows={2} value={reason} onChange={(e) => setReason(e.target.value)} error={shown ? error : null} hint={REASON_HELP} />
        <ServerMessage message={server.message} />
      </fieldset>
    </form>
  );
}

export function ReleasePheeraModal({ record, submitting = false, onClose, onSubmit }) {
  return (
    <ActionShell title="Release Pheera" record={record} formId="pheera-release-form" submitText="Release Pheera" submitting={submitting} onClose={onClose}>
      <ReleaseForm key={record?.id} record={record} submitting={submitting} onSubmit={onSubmit} />
    </ActionShell>
  );
}
