import { Button, Modal } from "../../components/ui";
import ProductionEntryForm from "./ProductionEntryForm";

const FORM_ID = "production-entry-form";

/** Correct one saved production entry. New production is entered on the daily list, not here. A reason is required. */
export default function ProductionEntryModal({ open, entry, allTeams, preview, onClose, onSubmit }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Edit Production Entry"
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
        <ProductionEntryForm
          key={entry.id}
          formId={FORM_ID}
          entry={entry}
          allTeams={allTeams}
          defaultDate={entry.date}
          preview={preview}
          onSubmit={onSubmit}
        />
      )}
    </Modal>
  );
}
