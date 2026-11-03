import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, Save } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { Badge, Button, Card, CardBody, CardHeader, DatePicker, Select, useToast } from "../../components/ui";
import { validateBatch, validatePheeraDraft, emptyDraft } from "../../validators/pheeraValidator";
import { todayBusinessDate } from "../../utils/businessDate";
import { formatDate } from "../../utils/formatDate";
import { formatQuantity, UNITS } from "../../utils/materials";
import { STOP_REASON_LABELS, TRUCK_STATUS, TRUCK_STATUS_META } from "../../utils/truckStatus";
import { nextPheeraNumber, numberingGaps } from "./pheeraOps";
import { summarizePheeras } from "./pheeraSelectors";
import PheeraRowEditor, { DESTINATION_LIST_ID } from "./PheeraRowEditor";
import PheeraTable from "./PheeraTable";
import useTruckTrips from "./useTruckTrips";

const rand = () => Math.random().toString(36).slice(2, 8);
const newBatchId = () => `batch-${Date.now().toString(36)}-${rand()}`;
const blankRow = (base = {}) => ({ key: rand(), ...emptyDraft(), ...base });

const touched = (d) => Boolean(d.material || d.destination || d.quantity || d.remarks);

/**
 * Daily Pheera entry: pick the date and the truck, add one row per trip (material, quantity, destination, remarks),
 * then save them all at once. Pheera numbers (1, 2, 3 ...) are given when saved, per truck and per date.
 */
export default function PheeraEntryPanel() {
  const toast = useToast();
  const { trucks, rows: savedAll, allRecords, destinations, loading, savePheeraBatch } = useTruckTrips();
  const today = todayBusinessDate();

  const [businessDate, setBusinessDate] = useState(today);
  const [searchParams] = useSearchParams();
  // /trucks?tab=entry&truck=<id> (from the single-truck page) opens with that truck selected
  const [truckId, setTruckId] = useState(() => (trucks.some((t) => t.id === searchParams.get("truck")) ? searchParams.get("truck") : ""));
  const [drafts, setDrafts] = useState(() => [blankRow()]);
  const [showErrors, setShowErrors] = useState(false);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false); // blocks a second click before React has re-rendered
  const batchIdRef = useRef(newBatchId()); // same id on a retry, so the same entry is never saved twice

  const truck = trucks.find((t) => t.id === truckId) ?? null;
  const check = useMemo(() => validateBatch({ businessDate, truckId, today, trucks, drafts }), [businessDate, truckId, today, trucks, drafts]);
  const dirty = drafts.some(touched) || drafts.length > 1;

  // warn before closing / reloading the tab with entries that are not saved yet
  useEffect(() => {
    if (!dirty) return undefined;
    const handler = (e) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  const savedForDay = useMemo(
    () => savedAll.filter((r) => r.truckId === truckId && r.businessDate === businessDate).sort((a, b) => a.pheeraNumber - b.pheeraNumber),
    [savedAll, truckId, businessDate]
  );
  const savedSummary = summarizePheeras(savedForDay);
  const gaps = truckId && !check.contextErrors.businessDate ? numberingGaps(allRecords, truckId, businessDate) : [];
  const firstNumber = truckId && !check.contextErrors.businessDate ? nextPheeraNumber(allRecords, truckId, businessDate) : null;

  const draftSummary = summarizePheeras(drafts.map((d) => validatePheeraDraft(d).value).filter(Boolean));

  // the same material + quantity + destination twice in one entry is probably a double entry (allowed, but flagged)
  const duplicateHints = drafts.map((d, i) => {
    const v = validatePheeraDraft(d).value;
    if (!v) return null;
    const first = drafts.findIndex((o) => {
      const ov = validatePheeraDraft(o).value;
      return ov && ov.material === v.material && ov.quantity === v.quantity && ov.destination.toLowerCase() === v.destination.toLowerCase();
    });
    return first !== i ? `Same material, quantity and destination as row ${first + 1}. Remove it if it is a double entry.` : null;
  });

  const updateRow = (key, patch) => setDrafts((prev) => prev.map((d) => (d.key === key ? { ...d, ...patch } : d)));
  const removeRow = (key) => setDrafts((prev) => prev.filter((d) => d.key !== key));
  const addRow = () =>
    setDrafts((prev) => {
      const last = prev[prev.length - 1];
      // a new row starts with the previous material and destination (the quantity is always typed fresh)
      return [...prev, blankRow(last ? { material: last.material, destination: last.destination } : {})];
    });

  const handleSave = async () => {
    if (savingRef.current) return;
    setShowErrors(true);
    if (!check.valid) {
      toast.error(check.message ?? "Please check the entry");
      return;
    }
    savingRef.current = true;
    setSaving(true);
    try {
      const result = await savePheeraBatch({ batchId: batchIdRef.current, businessDate, truckId, drafts });
      if (result.duplicate) toast.info("This entry was already saved");
      else toast.success(`${result.records.length} Pheera saved for ${truck.truckNumber}`);
      setDrafts([blankRow()]);
      setShowErrors(false);
      batchIdRef.current = newBatchId();
    } catch (error) {
      // all-or-nothing: nothing was saved, so the entry stays on screen to try again
      toast.error(error?.message ? `Not saved: ${error.message}` : "Not saved. Please try again.");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const truckOptions = trucks.map((t) => ({
    value: t.id,
    label: `${t.truckNumber}${t.nickname ? ` (${t.nickname})` : ""}${t.model ? ` - ${t.model}` : ""}${t.status !== TRUCK_STATUS.WORKING ? ` [${TRUCK_STATUS_META[t.status].label}]` : ""}`,
  }));

  return (
    <div className="space-y-4 sm:space-y-5">
      <Card>
        <CardHeader title="Daily Pheera Entry" subtitle="Record every trip a truck made on one date." />
        <CardBody className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <DatePicker
              label="Date"
              required
              max={today}
              value={businessDate}
              onChange={(e) => setBusinessDate(e.target.value)}
              error={showErrors ? check.contextErrors.businessDate : undefined}
              hint="Dates are India time. Past dates are allowed, future dates are not."
            />
            <Select
              label="Truck"
              required
              placeholder="Select truck"
              value={truckId}
              onChange={(e) => setTruckId(e.target.value)}
              options={truckOptions}
              error={showErrors ? check.contextErrors.truckId : undefined}
            />
          </div>

          {truck && truck.status !== TRUCK_STATUS.WORKING && (
            <p className="flex flex-wrap items-center gap-2 rounded-lg bg-warning-soft px-3 py-2 text-sm text-amber-700">
              <Badge variant={TRUCK_STATUS_META[truck.status].variant}>{TRUCK_STATUS_META[truck.status].label}</Badge>
              {truck.status === TRUCK_STATUS.STOPPED ? `Stopped: ${STOP_REASON_LABELS[truck.stopReason] ?? "reason not set"}.` : "In maintenance."} You can still record trips from
              before it stopped.
            </p>
          )}
        </CardBody>
      </Card>

      {truckId && !check.contextErrors.businessDate && (
        <Card>
          <CardHeader
            title={`Already saved - ${truck?.truckNumber ?? ""}, ${formatDate(businessDate)}`}
            subtitle={
              savedForDay.length === 0
                ? "No Pheera saved yet for this truck on this date."
                : `${savedForDay.length} Pheera - ${formatQuantity(savedSummary.bricks, UNITS.BRICKS)} bricks, ${formatQuantity(savedSummary.tonnes, UNITS.TONNES)} tonnes`
            }
          />
          {savedForDay.length > 0 && (
            <CardBody>
              <PheeraTable rows={savedForDay} showTruck={false} />
            </CardBody>
          )}
          {gaps.length > 0 && (
            <CardBody className="pt-0">
              <p className="text-xs text-fg-muted">Numbers {gaps.map((g) => `#${g}`).join(", ")} are missing (a Pheera was deleted). They are never reused; new Pheera continue from #{firstNumber}.</p>
            </CardBody>
          )}
        </Card>
      )}

      <datalist id={DESTINATION_LIST_ID}>
        {destinations.map((d) => (
          <option key={d} value={d} />
        ))}
      </datalist>

      <div className="space-y-3">
        {drafts.length === 0 && (
          <Card>
            <CardBody className="text-center text-sm text-fg-muted">No Pheera in this entry. Add one to continue.</CardBody>
          </Card>
        )}
        {drafts.map((d, i) => (
          <PheeraRowEditor
            key={d.key}
            title={firstNumber ? `Pheera #${firstNumber + i}` : `Pheera ${i + 1}`}
            draft={d}
            errors={showErrors ? (check.rowErrors[i] ?? {}) : {}}
            duplicateHint={duplicateHints[i]}
            onChange={(patch) => updateRow(d.key, patch)}
            onRemove={() => removeRow(d.key)}
          />
        ))}
        {firstNumber && drafts.length > 0 && <p className="type-small">Pheera numbers are confirmed when you save.</p>}
      </div>

      <Card>
        <CardBody className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm" aria-live="polite">
            <p className="font-medium">
              This entry: {drafts.length} {drafts.length === 1 ? "row" : "rows"}
            </p>
            <p className="text-fg-muted">
              {formatQuantity(draftSummary.bricks, UNITS.BRICKS)} bricks - {formatQuantity(draftSummary.tonnes, UNITS.TONNES)} tonnes (valid rows)
            </p>
            {showErrors && check.message && (
              <p role="alert" className="mt-1 text-danger">
                {check.message}
              </p>
            )}
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button variant="outline" leftIcon={Plus} onClick={addRow} disabled={saving}>
              Add another Pheera
            </Button>
            <Button leftIcon={Save} onClick={handleSave} loading={saving} disabled={loading || drafts.length === 0}>
              {saving ? "Saving..." : `Save ${drafts.length} Pheera`}
            </Button>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
