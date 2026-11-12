import { useState } from "react";
import { Button, Modal } from "../../components/ui";
import PheeraPicker from "./PheeraPicker";
import { selectionSummary } from "./pheeraBilling";
import { formatQuantity, UNITS } from "../../utils/materials";

/**
 * Pick more Pheeras of the draft's own customer. `rows` = the server's billable list for that customer (already without Pheeras that are
 * reserved, billed, voided, internal or have another customer). `onAdd(ids)` returns the outcome; the dialog closes only when it worked.
 */
export default function AddPheerasModal({ open, customerName, rows, loading, loadError, onReload, busy, onAdd, onClose }) {
  const [selected, setSelected] = useState([]);
  const stillThere = selected.filter((id) => rows.some((r) => r.id === id)); // a Pheera taken meanwhile drops out; the rest stay ticked
  const chosen = rows.filter((r) => stillThere.includes(r.id));
  const total = selectionSummary(chosen);
  const toggle = (id) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const submit = async () => {
    if (stillThere.length === 0) return;
    const out = await onAdd(stillThere);
    if (out?.kind === "done" || out?.kind === "confirmed") {
      setSelected([]);
      onClose();
    }
  };

  return (
    <Modal
      open={open}
      onClose={busy ? () => {} : onClose}
      size="lg"
      title="Add Pheeras"
      description={customerName ? `Unbilled Pheeras of ${customerName}` : undefined}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={submit} loading={busy} disabled={busy || stillThere.length === 0}>
            Add {stillThere.length > 0 ? stillThere.length : ""} to draft
          </Button>
        </>
      }
    >
      {loadError && (
        <div role="alert" className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-danger-soft px-4 py-3 text-sm text-danger">
          <span>{loadError}</span>
          <Button variant="outline" size="sm" onClick={onReload}>Try again</Button>
        </div>
      )}
      {loading ? <p className="text-sm text-fg-muted">Loading Pheeras...</p> : <PheeraPicker rows={rows} selected={stillThere} onToggle={toggle} onToggleAll={(on) => setSelected(on ? rows.map((r) => r.id) : [])} disabled={busy} emptyText="No more unbilled Pheeras for this customer" />}
      {stillThere.length > 0 && (
        <p className="mt-3 text-sm" aria-live="polite">
          <strong>{total.count}</strong> selected{total.bricks > 0 && <> - {formatQuantity(total.bricks, UNITS.BRICKS)} bricks</>}{total.tonnes > 0 && <> - {formatQuantity(total.tonnes, UNITS.TONNES)} tonnes</>}
        </p>
      )}
    </Modal>
  );
}
