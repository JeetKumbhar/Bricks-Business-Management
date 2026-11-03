import { Trash2 } from "lucide-react";
import { Badge, Button, EmptyState } from "../../components/ui";
import ResponsiveTable from "../../components/common/ResponsiveTable";
import { formatDate } from "../../utils/formatDate";
import { formatWithUnit } from "../../utils/materials";

const quantityText = (r) => formatWithUnit(r.quantity, r.unit);

/**
 * Individual Pheera: a table on tablets / desktops, cards on phones.
 * `onDelete(row)` is optional; without it no delete button is shown.
 */
export default function PheeraTable({ rows, onDelete, showTruck = true, emptyText = "No Pheera found" }) {
  const deleteButton = (r) =>
    onDelete ? (
      <Button variant="ghost" size="sm" aria-label={`Delete Pheera ${r.pheeraNumber} of ${r.registration} on ${r.businessDate}`} onClick={() => onDelete(r)}>
        <Trash2 className="h-4 w-4" aria-hidden="true" />
      </Button>
    ) : null;

  const columns = [
    { key: "businessDate", header: "Date", render: (r) => formatDate(r.businessDate) },
    ...(showTruck ? [{ key: "registration", header: "Truck", render: (r) => <span className="font-medium">{r.registration}</span> }] : []),
    { key: "pheeraNumber", header: "Pheera", align: "right", render: (r) => `#${r.pheeraNumber}` },
    { key: "material", header: "Material", render: (r) => <Badge variant={r.unit === "bricks" ? "warning" : "info"} size="sm">{r.material}</Badge> },
    { key: "destination", header: "Destination" },
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
      {r.remarks && <p className="type-small">{r.remarks}</p>}
    </div>
  );

  return <ResponsiveTable columns={columns} data={rows} rowKey="id" renderCard={renderCard} empty={<EmptyState title={emptyText} />} />;
}
