import { useCallback, useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Badge, Button, Card, CardBody, CardHeader, ConfirmDialog, EmptyState } from "../../components/ui";
import ResponsiveTable from "../../components/common/ResponsiveTable";
import { fetchBillablePheeras } from "../../services/pheeraApi";
import { getErrorMessage } from "../../services/api";
import { formatDate } from "../../utils/formatDate";
import { formatWithUnit } from "../../utils/materials";
import { lifecycleMeta } from "../trucks/pheeraLifecycle";
import AddPheerasModal from "./AddPheerasModal";
import { canAddPheeras, canRemovePheera } from "./pheeraBilling";
import useDraftPheeras from "./useDraftPheeras";

const TONE = { error: "bg-danger-soft text-danger", warning: "bg-warning-soft text-amber-700", success: "bg-success-soft text-success" };

/**
 * The Pheeras on a bill (one line each) and, for a DRAFT, adding and removing them. Finalized and cancelled bills only show them.
 * `onBillChange(bill)` gets the server's bill after each confirmed change; `onPheerasChanged()` lets the Pheera / Bill lists re-read.
 */
export default function BillPheeraPanel({ bill, onBillChange, onPheerasChanged }) {
  const lines = useDraftPheeras(bill, { onBillChange: (b) => { onBillChange?.(b); onPheerasChanged?.(); } });
  const [removing, setRemoving] = useState(null);
  const [adding, setAdding] = useState(false);
  const [offer, setOffer] = useState({ rows: [], loading: false, error: null });
  const [offerKey, setOfferKey] = useState(0);
  const draft = bill.status === "DRAFT";
  const mayAdd = canAddPheeras(bill);

  useEffect(() => {
    if (!adding || !bill.customerId) return undefined;
    const controller = new AbortController();
    fetchBillablePheeras({ customerId: bill.customerId }, { signal: controller.signal })
      .then((rows) => !controller.signal.aborted && setOffer({ rows, loading: false, error: null }))
      .catch((error) => !controller.signal.aborted && setOffer({ rows: [], loading: false, error: getErrorMessage(error, "Could not load the Pheeras") }));
    return () => controller.abort();
  }, [adding, bill.customerId, offerKey, bill.revision]);

  const openAdd = () => {
    setOffer({ rows: [], loading: true, error: null });
    setAdding(true);
  };
  const reloadOffer = useCallback(() => {
    setOffer((o) => ({ ...o, loading: true, error: null }));
    setOfferKey((k) => k + 1);
  }, []);
  const doAdd = async (ids) => {
    const out = await lines.add(ids);
    if (out.kind === "refused") reloadOffer(); // what is still available now
    return out;
  };
  const confirmRemove = async () => {
    const target = removing;
    setRemoving(null);
    await lines.remove(target.id);
  };

  const removeButton = (t) =>
    draft && canRemovePheera(bill) ? (
      <Button variant="ghost" size="sm" disabled={lines.locked} aria-label={`Remove Pheera ${t.pheeraNumber} of ${t.truckRegistration} from the draft`} onClick={() => setRemoving(t)}>
        <Trash2 className="h-4 w-4" aria-hidden="true" />
      </Button>
    ) : null;
  const status = (t) => <Badge variant={lifecycleMeta(t).variant} size="sm">{lifecycleMeta(t).label}</Badge>;
  const columns = [
    { key: "businessDate", header: "Date", render: (t) => formatDate(t.businessDate) },
    { key: "truck", header: "Truck", render: (t) => <span className="font-medium">{t.truckRegistration}</span> },
    { key: "pheeraNumber", header: "Pheera", align: "right", render: (t) => `#${t.pheeraNumber}` },
    { key: "material", header: "Material", render: (t) => t.material },
    { key: "destination", header: "Destination" },
    { key: "quantity", header: "Quantity", align: "right", render: (t) => <span className="font-semibold">{formatWithUnit(t.quantity, t.unit)}</span> },
    { key: "status", header: "Status", render: status },
    ...(draft ? [{ key: "actions", header: "", align: "right", render: removeButton }] : []),
  ];
  const card = (t) => (
    <div className="space-y-1 text-sm">
      <div className="flex items-start justify-between gap-2">
        <p className="font-semibold">{t.truckRegistration} - Pheera #{t.pheeraNumber}</p>
        <span className="flex items-center gap-1">{status(t)}{removeButton(t)}</span>
      </div>
      <p className="type-small">{formatDate(t.businessDate)} - {t.material} to {t.destination}</p>
      <p className="font-semibold">{formatWithUnit(t.quantity, t.unit)}</p>
    </div>
  );

  const n = lines.rows.length;
  return (
    <Card>
      <CardHeader
        title="Pheeras on this bill"
        subtitle={draft ? "One line per Pheera. Quantity and unit come from the Pheera; enter the rate, HSN and tax rate in Edit." : "Read-only: these Pheeras belong to this bill."}
        action={draft ? <Button variant="outline" size="sm" leftIcon={Plus} onClick={openAdd} disabled={!mayAdd || lines.locked} title={mayAdd ? undefined : "Pheeras can only be added to a draft linked to a saved customer"}>Add Pheeras</Button> : null}
      />
      <CardBody className="space-y-3">
        {draft && !mayAdd && <p className="type-small">This draft is not linked to a saved customer, so Pheeras can only be added to drafts made with "Bill from Pheeras".</p>}
        {lines.notice && (
          <div role={lines.notice.tone === "error" ? "alert" : "status"} className={`flex flex-wrap items-center justify-between gap-2 rounded-lg px-4 py-3 text-sm ${TONE[lines.notice.tone]}`}>
            <span>
              {lines.notice.text}
              {lines.notice.problems?.map((p) => <span key={p} className="block">{p}</span>)}
            </span>
            {lines.notice.unconfirmed && <Button variant="outline" size="sm" onClick={lines.recheck} loading={lines.busy}>Check again</Button>}
          </div>
        )}
        {lines.loadError && <p role="alert" className="text-sm text-danger">{lines.loadError}</p>}
        {lines.loading ? <p className="text-sm text-fg-muted" aria-live="polite">Loading Pheeras...</p> : <ResponsiveTable columns={columns} data={lines.rows} rowKey="id" renderCard={card} empty={<EmptyState title="No Pheeras on this bill" />} />}
        {n > 0 && <p className="type-small">{n} {n === 1 ? "Pheera" : "Pheeras"}</p>}
      </CardBody>

      <AddPheerasModal open={adding} customerName={bill.customer?.name} rows={offer.rows} loading={offer.loading} loadError={offer.error} onReload={reloadOffer} busy={lines.busy} onAdd={doAdd} onClose={() => setAdding(false)} />
      <ConfirmDialog
        open={Boolean(removing)}
        title="Remove this Pheera from the draft?"
        message={removing ? `${removing.truckRegistration}, Pheera #${removing.pheeraNumber} on ${formatDate(removing.businessDate)} will leave this draft and become "Not billed" again, so it can be billed later. The bill total is recalculated by the server.` : ""}
        confirmText="Remove Pheera"
        variant="danger"
        onConfirm={confirmRemove}
        onCancel={() => setRemoving(null)}
      />
    </Card>
  );
}
