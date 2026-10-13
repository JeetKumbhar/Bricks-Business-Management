import { Button, Modal } from "../../../components/ui";
import MaapEntryForm from "./MaapEntryForm";

const FORM_ID = "maap-entry-form";

/**
 * Add a work entry (entry = null) or correct one (entry = the record).
 * formKey changes after "Save & Add Another" so the form resets but keeps the date.
 */
export default function MaapEntryModal({
  open,
  entry,
  workers,
  allWorkers,
  defaultDate,
  formKey,
  getDayTotal,
  onClose,
  onSubmit,
}) {
  const isEdit = Boolean(entry);

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={isEdit ? "Edit Work Entry" : "Add Work Entry"}
      description={isEdit ? "Correct this entry. A reason is required." : "Record maaps transported by a Maapvali worker."}
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
      <MaapEntryForm
        key={formKey}
        formId={FORM_ID}
        entry={entry}
        workers={workers}
        allWorkers={allWorkers}
        defaultDate={defaultDate}
        getDayTotal={getDayTotal}
        onSubmit={onSubmit}
      />
    </Modal>
  );
}
