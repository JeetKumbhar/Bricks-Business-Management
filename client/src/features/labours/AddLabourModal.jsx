import { Button, Modal } from "../../components/ui";
import { toISODate } from "../../utils/formatDate";
import LabourForm from "./LabourForm";

const FORM_ID = "add-labour-form";

/**
 * <AddLabourModal open onClose nextLabourId isMobileTaken onSubmit={(values) => ...} />
 * values: { labourType, name, mobile, village, joiningDate, rate (number), status }
 * The form is only mounted while the modal is open, so it resets every time.
 */
export default function AddLabourModal({ open, onClose, nextLabourId, isMobileTaken, onSubmit }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Add Labour"
      description="Add a Bigari, a Maapvali or a Patlavale team."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form={FORM_ID}>
            Save
          </Button>
        </>
      }
    >
      <LabourForm
        formId={FORM_ID}
        mode="add"
        labourId={nextLabourId}
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
