
import { useState } from "react";
import { CalendarRange, Plus } from "lucide-react";
import { Badge, Button, DatePicker, Input, Modal, useToast } from "../../components/ui";
import { getErrorMessage } from "../../services/api";
import { formatDate } from "../../utils/formatDate";
import useLabours from "../labours/useLabours";
import { validateSeason } from "./seasonValidation";

const FORM_ID = "create-season-form";

function SeasonModal({ open, defaultStart, onClose }) {
  const toast = useToast();
  const { createSeason } = useLabours();
  const [values, setValues] = useState({ name: "", startDate: defaultStart, endDate: "" });
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  const set = (field) => (e) => setValues((v) => ({ ...v, [field]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    if (saving) return;
    const found = validateSeason(values);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setSaving(true);
    try {
      const season = await createSeason({ name: values.name.trim(), startDate: values.startDate, endDate: values.endDate || undefined });
      toast.success(`${season.name} created`);
      onClose();
    } catch (err) {
      setErrors({ form: getErrorMessage(err, "Could not create the season.") });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={saving ? undefined : onClose}
      title="Create season"
      description="Patlavale production is counted in the season that covers its date. Seasons cannot overlap."
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" form={FORM_ID} loading={saving}>
            Create season
          </Button>
        </>
      }
    >
      <form id={FORM_ID} onSubmit={submit} noValidate className="space-y-4">
        {errors.form && (
          <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2.5 text-sm text-danger">
            {errors.form}
          </p>
        )}
        <Input label="Season name" required placeholder="e.g. Season 2026-27" value={values.name} onChange={set("name")} error={errors.name} />
        <DatePicker label="Start date" required value={values.startDate} onChange={set("startDate")} error={errors.startDate} />
        <DatePicker label="End date" value={values.endDate} onChange={set("endDate")} hint="Leave empty while the season is still running." error={errors.endDate} />
      </form>
    </Modal>
  );
}

/**
 * Shows which season the chosen production date belongs to. If no season covers the date, production cannot be saved
 * (the server refuses it), so this offers to create one.
 */
export default function SeasonBanner({ date }) {
  const { seasonForDate } = useLabours();
  const [open, setOpen] = useState(false);
  const season = seasonForDate(date);

  return (
    <>
      {season ? (
        <p className="flex flex-wrap items-center gap-2 rounded-lg bg-background px-3 py-2.5 text-xs text-fg-muted">
          <CalendarRange className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>
            Season: <strong className="font-semibold text-fg">{season.name}</strong> ({formatDate(season.startDate)} to {season.endDate ? formatDate(season.endDate) : "ongoing"})
          </span>
          {season.status === "CLOSED" && <Badge variant="warning" size="sm">Closed: production in it cannot be changed</Badge>}
        </p>
      ) : (
        <div role="status" className="flex flex-col gap-3 rounded-lg bg-warning-soft px-3 py-3 text-sm text-amber-900 sm:flex-row sm:items-center sm:justify-between">
          <p>
            <strong>No season covers {formatDate(date)}.</strong> Production cannot be saved until a season is created for this date.
          </p>
          <Button size="sm" leftIcon={Plus} onClick={() => setOpen(true)} className="shrink-0 self-start sm:self-auto">
            Create season
          </Button>
        </div>
      )}
      {open && <SeasonModal open={open} defaultStart={date} onClose={() => setOpen(false)} />}
    </>
  );
}
