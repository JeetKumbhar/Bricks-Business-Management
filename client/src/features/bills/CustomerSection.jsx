import { UserRound } from "lucide-react";
import { Card, CardBody, CardHeader, Input, Select, Textarea } from "../../components/ui";
import { LIMITS } from "./billModel";

/**
 * Customer / M/s details. Only the name is required. GSTIN may be blank (unregistered customer); when typed it is
 * checked. A customer from an earlier bill can be picked to fill the fields, or a new one typed.
 */
export default function CustomerSection({ customer, errors, savedCustomers, onChange, gst = true, lockedName = false }) {
  const pick = (e) => {
    const chosen = savedCustomers.find((c) => c.name === e.target.value);
    if (chosen) onChange({ name: chosen.name, address: chosen.address, gstin: chosen.gstin, stateName: chosen.stateName, stateCode: chosen.stateCode, contact: chosen.contact });
  };
  return (
    <Card>
      <CardHeader title="Customer Details" subtitle="Who the bill is made out to (M/s.)" icon={UserRound} />
      <CardBody className="space-y-3">
        {savedCustomers.length > 0 && !lockedName && (
          <Select
            label="Saved customer"
            placeholder="Choose a customer from earlier bills, or type a new one below"
            value=""
            onChange={pick}
            options={savedCustomers.map((c) => ({ value: c.name, label: c.name }))}
          />
        )}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Input label="Customer Name / M/s." required readOnly={lockedName} hint={lockedName ? "A saved customer. The name cannot be changed on this bill." : undefined} maxLength={LIMITS.name} value={customer.name} onChange={(e) => onChange({ name: e.target.value })} error={errors.name} wrapperClassName="sm:col-span-2" />
          <Textarea label="Billing Address" required rows={2} maxLength={LIMITS.address} hint="Needed to finalize. Long addresses are cut to fit on the printed bill" value={customer.address} onChange={(e) => onChange({ address: e.target.value })} error={errors.address} wrapperClassName="sm:col-span-2" />
          <Input label="GSTIN" placeholder="Leave blank if the customer has no GSTIN" autoCapitalize="characters" maxLength={15} value={customer.gstin} onChange={(e) => onChange({ gstin: e.target.value.toUpperCase() })} error={errors.gstin} />
          <Input label="Contact Number" inputMode="tel" value={customer.contact} onChange={(e) => onChange({ contact: e.target.value })} error={errors.contact} />
          <Input label="State" placeholder="e.g. Gujarat" maxLength={LIMITS.name} value={customer.stateName} onChange={(e) => onChange({ stateName: e.target.value })} error={errors.stateName} />
          <Input label="State Code" required={gst} placeholder="e.g. 24" inputMode="numeric" maxLength={2} hint="Decides CGST + SGST or IGST" value={customer.stateCode} onChange={(e) => onChange({ stateCode: e.target.value })} error={errors.stateCode} />
        </div>
      </CardBody>
    </Card>
  );
}
