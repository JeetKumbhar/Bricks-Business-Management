import { Badge, EmptyState } from "../../components/ui";
import ResponsiveTable from "../../components/common/ResponsiveTable";
import { formatDate } from "../../utils/formatDate";
import { formatWithUnit } from "../../utils/materials";

/**
 * A list of billable Pheeras with a checkbox each (one Pheera = one future bill line). Only what the server offered is listed.
 * Props: rows, selected (ids), onToggle(id), onToggleAll(boolean), disabled.
 */
export default function PheeraPicker({ rows, selected, onToggle, onToggleAll, disabled = false, emptyText = "No unbilled Pheeras for this customer" }) {
  const allOn = rows.length > 0 && selected.length === rows.length;
  const box = (r) => (
    <input type="checkbox" className="h-5 w-5 accent-primary" checked={selected.includes(r.id)} disabled={disabled} onChange={() => onToggle(r.id)} aria-label={`Select Pheera ${r.pheeraNumber} of ${r.truckRegistration} on ${r.businessDate}`} />
  );
  const columns = [
    { key: "pick", header: <input type="checkbox" className="h-5 w-5 accent-primary" checked={allOn} disabled={disabled || rows.length === 0} onChange={(e) => onToggleAll(e.target.checked)} aria-label="Select all Pheeras" />, render: box },
    { key: "businessDate", header: "Date", render: (r) => formatDate(r.businessDate) },
    { key: "truck", header: "Truck", render: (r) => <span className="font-medium">{r.truckRegistration}</span> },
    { key: "pheeraNumber", header: "Pheera", align: "right", render: (r) => `#${r.pheeraNumber}` },
    { key: "material", header: "Material", render: (r) => <Badge variant={r.unit === "bricks" ? "warning" : "info"} size="sm">{r.material}</Badge> },
    { key: "destination", header: "Destination" },
    { key: "quantity", header: "Quantity", align: "right", render: (r) => <span className="font-semibold">{formatWithUnit(r.quantity, r.unit)}</span> },
  ];
  const card = (r) => (
    <label className="flex cursor-pointer items-start gap-3">
      {box(r)}
      <span className="min-w-0 space-y-0.5 text-sm">
        <span className="block font-semibold">
          {r.truckRegistration} - Pheera #{r.pheeraNumber}
        </span>
        <span className="type-small block">{formatDate(r.businessDate)} - {r.material} to {r.destination}</span>
        <span className="block font-semibold">{formatWithUnit(r.quantity, r.unit)}</span>
      </span>
    </label>
  );
  return <ResponsiveTable columns={columns} data={rows} rowKey="id" renderCard={card} empty={<EmptyState title={emptyText} />} />;
}
