import { Pencil, RotateCcw, Trash2, UserRound } from "lucide-react";
import { Badge, Button, EmptyState } from "../../components/ui";
import ResponsiveTable from "../../components/common/ResponsiveTable";
import { formatDate } from "../../utils/formatDate";
import { formatWithUnit } from "../../utils/materials";
import { availableActions, isVoidedRecord, lifecycleMeta, lockedReason } from "./pheeraLifecycle";

const quantityText = (r) => formatWithUnit(r.quantity, r.unit);

// Billing status comes from the server. Older Pheeras (saved before customers existed) have NO status (null): shown as "Older record", never guessed.
const billingMeta = lifecycleMeta;
const customerText = (r) => r.customerName ?? "No customer";

const extraNote = (r) =>
  isVoidedRecord(r) ? (
    <p className="type-small text-danger">Voided{r.deletedReason ? `: ${r.deletedReason}` : ""}</p>
  ) : r.corrected ? (
    <p className="type-small">Corrected after saving</p>
  ) : null;

/**
 * Individual Pheera: a table on tablets / desktops, cards on phones.
 * `onDelete(row)` is optional; without it no delete button is shown.
 */
export default function PheeraTable({ rows, onDelete, onCorrect, onAssign, onRelease, showTruck = true, emptyText = "No Pheera found" }) {
  const label = (r) => `Pheera ${r.pheeraNumber} of ${r.registration} on ${r.businessDate}`;
  const hasActions = Boolean(onDelete || onCorrect || onAssign || onRelease);
  const actionButtons = (r) => {
    if (!hasActions) return null;
    const can = availableActions(r);
    const why = lockedReason(r);
    const btn = (key, handler, allowed, Icon, text) =>
      handler && (allowed || key === "delete") ? (
        <Button key={key} variant="ghost" size="sm" disabled={!allowed} title={allowed ? text : why} aria-label={`${text} ${label(r)}`} onClick={() => handler(r)}>
          <Icon className="h-4 w-4" aria-hidden="true" />
        </Button>
      ) : null;
    return (
      <span className="inline-flex items-center gap-0.5">
        {btn("correct", onCorrect, can.correct, Pencil, "Correct")}
        {btn("assign", onAssign, can.assign, UserRound, r.customerName ? "Change customer of" : "Assign customer to")}
        {btn("release", onRelease, can.release, RotateCcw, "Release")}
        {btn("delete", onDelete, can.void, Trash2, "Delete")}
      </span>
    );
  };

  const columns = [
    { key: "businessDate", header: "Date", render: (r) => formatDate(r.businessDate) },
    ...(showTruck ? [{ key: "registration", header: "Truck", render: (r) => <span className="font-medium">{r.registration}</span> }] : []),
    { key: "pheeraNumber", header: "Pheera", align: "right", render: (r) => `#${r.pheeraNumber}` },
    { key: "material", header: "Material", render: (r) => <Badge variant={r.unit === "bricks" ? "warning" : "info"} size="sm">{r.material}</Badge> },
    { key: "destination", header: "Destination" },
    { key: "customer", header: "Customer", render: (r) => (r.customerName ? r.customerName : <span className="text-fg-muted">No customer</span>) },
    { key: "billing", header: "Billing", render: (r) => (<span className="inline-flex flex-wrap items-center gap-1"><Badge variant={billingMeta(r).variant} size="sm">{billingMeta(r).label}</Badge>{r.corrected && !isVoidedRecord(r) && <span className="type-small">corrected</span>}{isVoidedRecord(r) && r.deletedReason && <span className="type-small text-danger" title={r.deletedReason}>{r.deletedReason}</span>}</span>) },
    { key: "quantity", header: "Quantity", align: "right", render: (r) => <span className="font-semibold">{quantityText(r)}</span> },
    { key: "remarks", header: "Remarks", className: "max-w-64 truncate", render: (r) => r.remarks || <span className="text-fg-muted">-</span> },
    ...(hasActions ? [{ key: "actions", header: "", align: "right", render: actionButtons }] : []),
  ];

  const renderCard = (r) => (
    <div className="space-y-1.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold">
            {showTruck ? `${r.registration} - ` : ""}Pheera #{r.pheeraNumber}
          </p>
          <p className="type-small">{formatDate(r.businessDate)}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Badge variant={r.unit === "bricks" ? "warning" : "info"} size="sm">
            {r.material}
          </Badge>
          {actionButtons(r)}
        </div>
      </div>
      <p className="text-sm">
        <span className="font-semibold">{quantityText(r)}</span> to {r.destination}
      </p>
      <p className="type-small flex flex-wrap items-center gap-1.5">
        {customerText(r)}
        <Badge variant={billingMeta(r).variant} size="sm">
          {billingMeta(r).label}
        </Badge>
      </p>
      {r.remarks && <p className="type-small">{r.remarks}</p>}
      {extraNote(r)}
    </div>
  );

  return <ResponsiveTable columns={columns} data={rows} rowKey="id" renderCard={renderCard} empty={<EmptyState title={emptyText} />} />;
}
