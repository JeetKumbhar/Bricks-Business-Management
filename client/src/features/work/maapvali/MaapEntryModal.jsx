import { Button, Modal } from "../../../components/ui";
import MaapEntryForm from "./MaapEntryForm";

const FORM_ID = "maap-entry-form";

/** Correct one saved work entry. New work is entered on the daily list, not here. A reason is required. */
export default function MaapEntryModal({ open, entry, allWorkers, previewEntry, onClose, onSubmit }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Edit Work Entry"
      description="Correct this entry. A reason is required."
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
      {entry && (
        <MaapEntryForm
          key={entry.id}
          formId={FORM_ID}
          entry={entry}
          allWorkers={allWorkers}
          defaultDate={entry.date}
          previewEntry={previewEntry}
          onSubmit={onSubmit}
        />
      )}
    </Modal>
  );
}
