import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button, Input, Modal, Textarea } from "../../components/ui";
import { customerSchema } from "../../validators/customerValidator";
import { formValuesOf } from "./customerView";

const FORM_ID = "customer-form";
const SERVER_FIELDS = ["name", "address", "gstin", "stateName", "stateCode", "contact"];


function CustomerForm({ customer, submitting, onSubmit }) {
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm({ resolver: zodResolver(customerSchema), defaultValues: formValuesOf(customer) });

  // the server's refusal for a field is shown under that field; what was typed stays in the form
  const submit = async (values) => {
    const result = await onSubmit(values);
    for (const [field, message] of Object.entries(result?.fieldErrors ?? {})) if (SERVER_FIELDS.includes(field)) setError(field, { type: "server", message });
  };

  return (
    <form id={FORM_ID} noValidate onSubmit={handleSubmit(submit)} className="space-y-4">
      <fieldset disabled={submitting} className="m-0 min-w-0 space-y-4 border-0 p-0">
        <Input label="Customer name" required autoFocus maxLength={120} error={errors.name?.message} {...register("name")} />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input label="Contact number" inputMode="tel" error={errors.contact?.message} {...register("contact")} />
          <Input label="GSTIN" maxLength={15} hint="Optional" error={errors.gstin?.message} {...register("gstin")} />
          <Input label="State" error={errors.stateName?.message} {...register("stateName")} />
          <Input label="State code" inputMode="numeric" maxLength={2} hint="2 digits, e.g. 27" error={errors.stateCode?.message} {...register("stateCode")} />
        </div>
        <Textarea label="Address" rows={2} maxLength={300} error={errors.address?.message} {...register("address")} />
      </fieldset>
    </form>
  );
}

/**
 * Add / edit a customer. `customer` = the customer being edited (null = add). The edit sends the revision the form was opened with,
 * so a change made by someone else in between is refused (`conflict` = the server's message): the entered values are kept and the
 * owner may press "Load latest" to replace them with the saved ones. `unconfirmed` = the answer was lost: saving is blocked until checked.
 */
export default function CustomerFormModal({ open, customer, submitting = false, conflict = null, unconfirmed = null, onLoadLatest, onRecheck, onClose, onSubmit }) {
  const [formKey, setFormKey] = useState(0); // a new key re-creates the form with the latest saved values
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={customer ? "Edit Customer" : "Add Customer"}
      description={customer ? undefined : "Every Pheera and invoice needs a customer."}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button type="submit" form={FORM_ID} loading={submitting} disabled={submitting || Boolean(unconfirmed)}>
            {submitting ? "Saving..." : customer ? "Save Changes" : "Save Customer"}
          </Button>
        </>
      }
    >
      {conflict && (
        <div role="alert" className="mb-4 space-y-2 rounded-lg border border-warning bg-warning-soft px-3 py-2.5 text-sm text-amber-800">
          <p className="font-semibold">Changed by someone else</p>
          <p>
            {conflict} Nothing was overwritten. Your entries are still here; "Load latest" replaces them with the values that are saved now.
          </p>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              onLoadLatest?.();
              setFormKey((k) => k + 1);
            }}
          >
            Load latest
          </Button>
        </div>
      )}
      {unconfirmed && (
        <div role="alert" className="mb-4 space-y-2 rounded-lg border border-warning bg-warning-soft px-3 py-2.5 text-sm text-amber-800">
          <p className="font-semibold">Not confirmed</p>
          <p>{unconfirmed}</p>
          <Button size="sm" variant="outline" onClick={onRecheck}>
            Check the list
          </Button>
        </div>
      )}
      {open && <CustomerForm key={`${customer?.id ?? "new"}-${customer?.revision ?? 0}-${formKey}`} customer={customer} submitting={submitting || Boolean(unconfirmed)} onSubmit={onSubmit} />}
    </Modal>
  );
}
