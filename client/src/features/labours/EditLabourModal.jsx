import { Button, Modal } from "../../components/ui";
import LabourForm from "./LabourForm";
import { toFormValues } from "./labourRecord";

const FORM_ID = "edit-labour-form";

/**
 * <EditLabourModal labour={editingLabour} onClose isMobileTaken={(mobile) => ...} onSubmit={(id, values) => ...} />
 * Opens whenever `labour` is set. Type and rate are shown read-only.
 */
export default function EditLabourModal({ labour, onClose, isMobileTaken, onSubmit }) {
  return (
    <Modal
      open={Boolean(labour)}
      onClose={onClose}
      size="lg"
      title="Edit Labour"
      description={labour ? `${labour.id} - ${labour.name}` : undefined}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form={FORM_ID}>
            Save Changes
          </Button>
        </>
      }
    >
      {labour && (
        <LabourForm
          formId={FORM_ID}
          mode="edit"
          labourId={labour.id}
          isMobileTaken={isMobileTaken}
          onSubmit={(values) => onSubmit(labour.id, values)}
          defaultValues={toFormValues(labour)}
        />
      )}
    </Modal>
  );
}
