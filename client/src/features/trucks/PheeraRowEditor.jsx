import { Trash2 } from "lucide-react";
import { Badge, Button, Card, CardBody, Input, Select } from "../../components/ui";
import { CUSTOM_MATERIAL_MAX, MATERIAL_CHOICES, OTHER, quantityRule, unitForMaterial } from "../../utils/materials";

export const DESTINATION_LIST_ID = "pheera-entry-destinations";
export const MATERIAL_LIST_ID = "pheera-entry-materials";

/**
 * One Pheera in the entry form. Material is a standard material (Bricks, Sand, Stone, Khadi Matti, Grawal, Hard Murram, Soil) or Other.
 * Bricks ask for "Number of Bricks" (whole numbers); every other material asks for "Weight (Tonnes)". Other also asks for the real material name, which is what gets saved.
 * `errors` only has messages after the first save attempt.
 */
export default function PheeraRowEditor({ title, draft, errors = {}, duplicateHint, onChange, onRemove }) {
  const rule = draft.material ? quantityRule(draft.material) : null;

  return (
    <Card>
      <CardBody className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <h3 className="type-card-heading">{title}</h3>
            <Badge variant="warning" size="sm">
              Not saved yet
            </Badge>
          </div>
          <Button variant="ghost" size="sm" leftIcon={Trash2} onClick={onRemove} aria-label={`Remove ${title}`}>
            Remove
          </Button>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Select
            label="Material"
            required
            placeholder="Select material"
            value={draft.material}
            // switching between bricks and tonnes changes the unit, so a quantity typed for the old unit is cleared
            onChange={(e) => {
              const material = e.target.value;
              const unitChanged = draft.material && material && unitForMaterial(draft.material) !== unitForMaterial(material);
              // a typed name only belongs to "Other"
              onChange({ material, ...(unitChanged ? { quantity: "" } : {}), ...(material !== OTHER ? { customMaterial: "" } : {}) });
            }}
            options={MATERIAL_CHOICES.map((m) => ({ value: m, label: m }))}
            error={errors.material}
          />
          <Input
            label={rule ? rule.label : "Quantity"}
            required
            inputMode={rule?.inputMode ?? "decimal"}
            autoComplete="off"
            placeholder={rule?.placeholder ?? "Choose a material first"}
            hint={rule ? (rule.integerOnly ? "Whole numbers only" : "Up to 2 decimals, in tonnes") : undefined}
            value={draft.quantity}
            onChange={(e) => onChange({ quantity: e.target.value })}
            error={errors.quantity}
          />
          <Input
            label="Destination"
            required
            list={DESTINATION_LIST_ID}
            autoComplete="off"
            placeholder="e.g. Palghar"
            value={draft.destination}
            onChange={(e) => onChange({ destination: e.target.value })}
            error={errors.destination}
          />
          <Input label="Remarks" placeholder="Optional" value={draft.remarks} onChange={(e) => onChange({ remarks: e.target.value })} error={errors.remarks} />
        </div>

        {draft.material === OTHER && (
          <Input
            label="Material Type"
            required
            list={MATERIAL_LIST_ID}
            autoComplete="off"
            maxLength={CUSTOM_MATERIAL_MAX}
            placeholder="Enter material name, e.g. Stone Dust"
            value={draft.customMaterial ?? ""}
            onChange={(e) => onChange({ customMaterial: e.target.value })}
            error={errors.customMaterial}
            wrapperClassName="sm:max-w-sm"
          />
        )}

        {duplicateHint && <p className="text-xs text-warning">{duplicateHint}</p>}
      </CardBody>
    </Card>
  );
}
