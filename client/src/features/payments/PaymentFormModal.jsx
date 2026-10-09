import { Button, Modal } from "../../components/ui";
import PaymentForm from "./PaymentForm";

const FORM_ID = "payment-form";

/**
 * Add a payment (payment = null) or correct one (payment = the record).
 * The form mounts only while the modal is open, so it resets every time.
 */
export default function PaymentFormModal({ open, payment, labours, onClose, onSubmit }) {
  const isEdit = Boolean(payment);

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={isEdit ? "Edit Payment" : "Add Payment"}
      description={isEdit ? "Correct the details of this payment." : "Record money given to a labour."}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form={FORM_ID}>
            {isEdit ? "Save Changes" : "Save Payment"}
          </Button>
        </>
      }
    >
      <PaymentForm formId={FORM_ID} payment={payment} labours={labours} onSubmit={onSubmit} />
    </Modal>
  );
}
