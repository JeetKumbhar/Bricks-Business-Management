import { Button, Modal } from "../../components/ui";
import { toISODate } from "../../utils/formatDate";
import LabourForm from "./LabourForm";

const FORM_ID = "add-labour-form";

/**
 * <AddLabourModal open onClose isMobileTaken onSubmit={(values) => ...} saving />
 * values: { labourType, name, mobile, village, joiningDate, rate (number), status }
 * The labour ID is made by the server when the record is saved. The form is only mounted while the modal is open, so it resets every time.
 */
export default function AddLabourModal({ open, onClose, isMobileTaken, onSubmit, saving = false }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Add Labour"
      description="Add a Bigari, a Maapvali or a Patlavale team."
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" form={FORM_ID} loading={saving}>
            Save
          </Button>
        </>
      }
    >
      <LabourForm
        formId={FORM_ID}
        mode="add"
        labourId="Assigned when saved"
        isMobileTaken={isMobileTaken}
        onSubmit={onSubmit}
        defaultValues={{
          labourType: "BIGARI",
          name: "",
          mobile: "",
          village: "",
          joiningDate: toISODate(),
          rate: "",
          status: "ACTIVE",
        }}
      />
    </Modal>
  );
}
