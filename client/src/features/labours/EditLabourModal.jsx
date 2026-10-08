import { Button, Modal } from "../../components/ui";
import LabourForm from "./LabourForm";

const FORM_ID = "edit-labour-form";

/**
 * <EditLabourModal labour={editingLabour} onClose isMobileTaken={(mobile) => ...} onSubmit={(id, values) => ...} />
 * Opens whenever `labour` is set. Daily rate is shown read-only.
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
          labourId={labour.id}
          rateLocked
          isMobileTaken={isMobileTaken}
          onSubmit={(values) => onSubmit(labour.id, values)}
          defaultValues={{
            name: labour.name,
            mobile: labour.mobile,
            village: labour.village,
            joiningDate: labour.joiningDate,
            dailyRate: String(labour.dailyRate),
            status: labour.status,
          }}
        />
      )}
    </Modal>
  );
}
