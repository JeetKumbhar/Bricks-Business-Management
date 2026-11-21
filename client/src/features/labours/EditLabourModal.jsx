import { Button, Modal } from "../../components/ui";
import LabourForm from "./LabourForm";
import { toFormValues } from "./labourRecord";

const FORM_ID = "edit-labour-form";

/**
 * <EditLabourModal labour={editingLabour} onClose onSubmit={(id, values) => ...} />
 * Opens whenever `labour` is set. Type and rate are shown read-only.
 */
export default function EditLabourModal({ labour, onClose, onSubmit, saving = false }) {
  return (
    <Modal
      open={Boolean(labour)}
      onClose={onClose}
      size="lg"
      title="Edit Labour"
      description={labour ? `${labour.id} - ${labour.name}` : undefined}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" form={FORM_ID} loading={saving}>
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
          onSubmit={(values) => onSubmit(labour.id, values)}
          defaultValues={toFormValues(labour)}
        />
      )}
    </Modal>
  );
}
