import { Button, Modal } from "../../components/ui";
import ProductionEntryForm from "./ProductionEntryForm";

const FORM_ID = "production-entry-form";

/**
 * Add a production entry (entry = null) or correct one (entry = the record).
 * formKey changes after "Save & Add Another" so the form resets but keeps the date.
 */
export default function ProductionEntryModal({ open, entry, teams, allTeams, defaultDate, formKey, preview, onClose, onSubmit }) {
  const isEdit = Boolean(entry);

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={isEdit ? "Edit Production Entry" : "Add Production Entry"}
      description={isEdit ? "Correct this entry. A reason is required." : "Record raw bricks produced by a family / team."}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          {!isEdit && (
            <Button type="submit" form={FORM_ID} value="another" variant="outline">
              Save &amp; Add Another
            </Button>
          )}
          <Button type="submit" form={FORM_ID} value="close">
            {isEdit ? "Save Changes" : "Save Entry"}
          </Button>
        </>
      }
    >
      <ProductionEntryForm
        key={formKey}
        formId={FORM_ID}
        entry={entry}
        teams={teams}
        allTeams={allTeams}
        defaultDate={defaultDate}
        preview={preview}
        onSubmit={onSubmit}
      />
    </Modal>
  );
}
