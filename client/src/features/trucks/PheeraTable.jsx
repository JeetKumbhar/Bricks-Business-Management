import { Trash2 } from "lucide-react";
import { Badge, Button, EmptyState } from "../../components/ui";
import ResponsiveTable from "../../components/common/ResponsiveTable";
import { formatDate } from "../../utils/formatDate";
import { formatWithUnit } from "../../utils/materials";

const quantityText = (r) => formatWithUnit(r.quantity, r.unit);

// Billing status comes from the server. Older Pheeras (saved before customers existed) have NO status (null): shown as such, never guessed.
const BILLING = {
  UNBILLED: { label: "Not billed", variant: "info" },
  RESERVED: { label: "In draft bill", variant: "warning" },
  BILLED: { label: "Billed", variant: "success" },
  NOT_BILLABLE: { label: "No bill (internal)", variant: "neutral" },
};
const billingMeta = (r) => BILLING[r.billingStatus] ?? { label: "Older record", variant: "neutral" };
// A Pheera that is in a draft bill or billed is locked by the server (it refuses to void it), so the button is not offered.
const isLocked = (r) => r.billingStatus === "RESERVED" || r.billingStatus === "BILLED";
const customerText = (r) => r.customerName ?? "No customer";

/**
 * Individual Pheera: a table on tablets / desktops, cards on phones.
 * `onDelete(row)` is optional; without it no delete button is shown.
 */
export default function PheeraTable({ rows, onDelete, showTruck = true, emptyText = "No Pheera found" }) {
  const deleteButton = (r) =>
    onDelete ? (
      <Button
        variant="ghost"
        size="sm"
        disabled={isLocked(r)}
        title={isLocked(r) ? "Locked: this Pheera is in a bill" : undefined}
        aria-label={`Delete Pheera ${r.pheeraNumber} of ${r.registration} on ${r.businessDate}`}
        onClick={() => onDelete(r)}
      >
        <Trash2 className="h-4 w-4" aria-hidden="true" />
      </Button>
    ) : null;

  const columns = [
    { key: "businessDate", header: "Date", render: (r) => formatDate(r.businessDate) },
    ...(showTruck ? [{ key: "registration", header: "Truck", render: (r) => <span className="font-medium">{r.registration}</span> }] : []),
    { key: "pheeraNumber", header: "Pheera", align: "right", render: (r) => `#${r.pheeraNumber}` },
    { key: "material", header: "Material", render: (r) => <Badge variant={r.unit === "bricks" ? "warning" : "info"} size="sm">{r.material}</Badge> },
    { key: "destination", header: "Destination" },
    { key: "customer", header: "Customer", render: (r) => (r.customerName ? r.customerName : <span className="text-fg-muted">No customer</span>) },
    { key: "billing", header: "Billing", render: (r) => <Badge variant={billingMeta(r).variant} size="sm">{billingMeta(r).label}</Badge> },
    { key: "quantity", header: "Quantity", align: "right", render: (r) => <span className="font-semibold">{quantityText(r)}</span> },
    { key: "remarks", header: "Remarks", className: "max-w-64 truncate", render: (r) => r.remarks || <span className="text-fg-muted">-</span> },
    ...(onDelete ? [{ key: "actions", header: "", align: "right", render: deleteButton }] : []),
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
          {deleteButton(r)}
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
    </div>
  );

  return <ResponsiveTable columns={columns} data={rows} rowKey="id" renderCard={renderCard} empty={<EmptyState title={emptyText} />} />;
}
