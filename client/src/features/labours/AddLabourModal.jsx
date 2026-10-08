import { Button, Modal } from "../../components/ui";
import { toISODate } from "../../utils/formatDate";
import LabourForm from "./LabourForm";

const FORM_ID = "add-labour-form";

/**
 * <AddLabourModal open onClose nextLabourId isMobileTaken onSubmit={(values) => ...} />
 * The form is only mounted while the modal is open, so it resets every time.
 */
export default function AddLabourModal({ open, onClose, nextLabourId, isMobileTaken, onSubmit }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Add Labour"
      description="Enter the labour's details."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form={FORM_ID}>
            Save Labour
          </Button>
        </>
      }
    >
      <LabourForm
        formId={FORM_ID}
        labourId={nextLabourId}
        isMobileTaken={isMobileTaken}
        onSubmit={onSubmit}
        defaultValues={{
          name: "",
          mobile: "",
          village: "",
          joiningDate: toISODate(),
          dailyRate: "",
          status: "ACTIVE",
        }}
      />
    </Modal>
  );
}
