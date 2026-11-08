import { Plus, Trash2 } from "lucide-react";
import { Button, Card, CardBody, CardHeader, Input, Select } from "../../components/ui";
import { formatRupees } from "../../utils/money";
import { CUSTOM_MATERIAL, defaultUnitFor, LIMITS, MATERIAL_OPTIONS, TAX_MODE, UNIT_OPTIONS } from "./billModel";

const UNIT_LIST_ID = "bill-unit-options";

/**
 * The item table: any number of rows. Each row has Particulars, HSN/SAC, Quantity, Unit, Rate, Tax % (GST bills) and a calculated
 * Amount (quantity x rate). Picking a material fills Particulars (and a suggested unit) but everything stays editable,
 * so any custom material can be typed. Different units are never added together.
 */
export default function ItemsEditor({ items, errors, taxMode, totals, units = UNIT_OPTIONS, onChange, onAdd, onRemove, listError }) {
  const showTax = taxMode === TAX_MODE.GST;

  const pickMaterial = (index, item, material) => {
    if (!material) return;
    if (material === CUSTOM_MATERIAL) return onChange(index, { particulars: "" });
    onChange(index, { particulars: material, ...(item.unit ? {} : { unit: defaultUnitFor(material) }) });
  };

  return (
    <Card>
      <CardHeader title="Item Details" subtitle="Add every material on this bill" action={<Button variant="outline" leftIcon={Plus} onClick={onAdd}>Add Item</Button>} />
      <CardBody className="space-y-3">
        <datalist id={UNIT_LIST_ID}>
          {units.map((u) => (
            <option key={u} value={u} />
          ))}
        </datalist>
        {listError && (
          <p role="alert" className="text-sm text-danger">
            {listError}
          </p>
        )}
        {items.map((item, i) => {
          const e = errors[i] ?? {};
          return (
            <div key={item.key} className="rounded-xl border border-border p-3 sm:p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h3 className="type-card-heading">Item {i + 1}</h3>
                <Button variant="ghost" size="sm" leftIcon={Trash2} disabled={items.length === 1} onClick={() => onRemove(i)} aria-label={`Remove item ${i + 1}`}>
                  Remove
                </Button>
              </div>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-12">
                <Select
                  label="Material"
                  placeholder="Choose..."
                  value=""
                  onChange={(ev) => pickMaterial(i, item, ev.target.value)}
                  options={[...MATERIAL_OPTIONS, CUSTOM_MATERIAL].map((m) => ({ value: m, label: m }))}
                  wrapperClassName="col-span-2 md:col-span-3"
                />
                <Input label="Particulars" required maxLength={LIMITS.particulars} placeholder="e.g. Bricks" value={item.particulars} onChange={(ev) => onChange(i, { particulars: ev.target.value })} error={e.particulars} wrapperClassName="col-span-2 md:col-span-6" />
                <Input label="HSN/SAC" required={showTax} inputMode="numeric" maxLength={8} hint={showTax ? "4, 6 or 8 digits" : undefined} value={item.hsn} onChange={(ev) => onChange(i, { hsn: ev.target.value })} error={e.hsn} wrapperClassName="col-span-2 md:col-span-3" />
                <Input label="Quantity" required inputMode="decimal" value={item.quantity} onChange={(ev) => onChange(i, { quantity: ev.target.value })} error={e.quantity} wrapperClassName="md:col-span-2" />
                <Input label="Unit" required list={UNIT_LIST_ID} maxLength={LIMITS.unit} placeholder="Tonnes" value={item.unit} onChange={(ev) => onChange(i, { unit: ev.target.value })} error={e.unit} wrapperClassName="md:col-span-2" />
                <Input label="Rate (Rs per unit)" required inputMode="decimal" value={item.rate} onChange={(ev) => onChange(i, { rate: ev.target.value })} error={e.rate} wrapperClassName="md:col-span-3" />
                {showTax ? (
                  <Input label="Tax %" required inputMode="decimal" placeholder="e.g. 5" hint="Total GST rate (0 if nil-rated)" value={item.taxRate} onChange={(ev) => onChange(i, { taxRate: ev.target.value })} error={e.taxRate} wrapperClassName="md:col-span-2" />
                ) : (
                  <div className="hidden md:col-span-2 md:block" />
                )}
                <div className="col-span-2 flex flex-col justify-end md:col-span-3">
                  <p className="text-sm font-medium text-fg-muted">Amount</p>
                  <p className="rounded-lg bg-background px-3 py-2 text-right text-lg font-bold" aria-live="polite">
                    {formatRupees(totals.lines[i]?.amountPaise ?? 0)}
                  </p>
                </div>
              </div>
            </div>
          );
        })}
        <Button variant="outline" leftIcon={Plus} onClick={onAdd} className="w-full sm:w-auto">
          Add Item
        </Button>
      </CardBody>
    </Card>
  );
}
