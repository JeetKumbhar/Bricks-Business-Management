import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Plus, Save } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { Badge, Button, Card, CardBody, CardHeader, DatePicker, Select, useToast } from "../../components/ui";
import { useTruckStore } from "../../context/TruckContext";
import { ERROR_KIND } from "../../services/apiErrorKinds";
import { customerOptionsFor } from "../customers/customerChoices";
import useCustomerChoices from "../customers/useCustomerChoices";
import { validateBatch, validatePheeraDraft, emptyDraft } from "../../validators/pheeraValidator";
import { todayBusinessDate } from "../../utils/businessDate";
import { formatDate } from "../../utils/formatDate";
import { formatQuantity, UNITS } from "../../utils/materials";
import { STOP_REASON_LABELS, TRUCK_STATUS, TRUCK_STATUS_META } from "../../utils/truckStatus";
import { numberingGaps } from "./pheeraOps";
import { knownMaterials, summarizePheeras } from "./pheeraSelectors";
import PheeraRowEditor, { DESTINATION_LIST_ID, MATERIAL_LIST_ID } from "./PheeraRowEditor";
import NoCustomersNotice from "./NoCustomersNotice";
import { prepareEntry } from "./pheeraEntry";
import { createSaveFlow } from "./pheeraSaveFlow";
import PheeraTable from "./PheeraTable";
import useTruckTrips from "./useTruckTrips";

const rand = () => Math.random().toString(36).slice(2, 8);
// `key` is also the row's stable clientRowId ("row-<key>"): it never changes while the row is on screen, so a retry sends the same row ids.
const blankRow = (base = {}) => ({ key: rand(), ...emptyDraft(), customerId: "", ...base });

const touched = (d) => Boolean(d.customerId || d.material || d.customMaterial || d.destination || d.quantity || d.remarks);

// the server names the typed material "customMaterialName"; the form calls it "customMaterial"
const toFormErrors = (row = {}) => {
  const { customMaterialName, ...rest } = row;
  return customMaterialName ? { ...rest, customMaterial: customMaterialName } : rest;
};

/**
 * Daily Pheera entry: pick the date and the truck, add one row per trip (customer, material, quantity, destination, remarks),
 * then save them all at once (all rows or none). The server gives the Pheera numbers and the units.
 *
 * Saving is safe to repeat: one submissionId per entry and one clientRowId per row. If the answer is lost (network / timeout / server
 * error) the outcome is UNKNOWN: the entry is locked and only "Retry save" (same submissionId, same rows) or an explicit
 * "Discard" is offered, so a Pheera is never saved twice and edits never get silently ignored. A refusal (400 / 409) means nothing
 * was saved: the server's messages are shown on the rows and the entry stays editable.
 */
export default function PheeraEntryPanel() {
  const toast = useToast();
  const { trucks, rows: savedAll, allRecords, destinations, loading, loadError, reload: reloadPheeras, savePheeraBatch } = useTruckTrips();
  const { status: truckStatus, loadError: truckLoadError, reload: reloadTrucks } = useTruckStore();
  const customers = useCustomerChoices();
  const today = todayBusinessDate();

  const [businessDate, setBusinessDate] = useState(today);
  const [searchParams] = useSearchParams();
  // /trucks?tab=entry&truck=<id> (from the single-truck page) opens with that truck selected (once the trucks have loaded)
  const [truckPick, setTruckPick] = useState("");
  const requestedTruck = searchParams.get("truck");
  const truckId = truckPick || (trucks.some((t) => t.id === requestedTruck) ? requestedTruck : "");
  const [drafts, setDrafts] = useState(() => [blankRow()]);
  const [showErrors, setShowErrors] = useState(false);
  // one flow per entry screen: it owns the submissionId, the in-flight lock and the "outcome unknown" state (see pheeraSaveFlow.js)
  const [flow] = useState(() => createSaveFlow({ save: savePheeraBatch }));
  const { saving, pending, serverErrors } = useSyncExternalStore(flow.subscribe, flow.getState);

  const truck = trucks.find((t) => t.id === truckId) ?? null;
  const check = useMemo(() => validateBatch({ businessDate, truckId, today, trucks, drafts, requireCustomer: true }), [businessDate, truckId, today, trucks, drafts]);
  const customNames = useMemo(() => knownMaterials(savedAll), [savedAll]);
  const dirty = drafts.some(touched) || drafts.length > 1 || Boolean(pending);
  const locked = saving || Boolean(pending);
  const { customers: customerList, internal: internalCustomer } = customers;
  const customerOptions = useMemo(() => customerOptionsFor({ customers: customerList, internal: internalCustomer }), [customerList, internalCustomer]);

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
      // a new row starts with the previous customer, material and destination (the quantity is always typed fresh)
      return [...prev, blankRow(last ? { customerId: last.customerId, material: last.material, customMaterial: last.customMaterial, destination: last.destination } : {})];
    });

  const handleSave = async () => {
    let payload;
    if (!pending) {
      setShowErrors(true);
      flow.clearServerErrors();
      if (!check.valid) {
        toast.error(check.message ?? "Please check the entry");
        return;
      }
      const prepared = prepareEntry({ businessDate, truckId, today, trucks, drafts, customNames });
      payload = prepared.payload;
    }
    const outcome = await flow.submit(payload); // when an earlier outcome is unknown, this re-sends THAT entry with THAT id
    if (outcome.status === "saved") {
      const { result } = outcome;
      if (result.duplicate) toast.info("This entry was already saved");
      else toast.success(`${result.records.length} Pheera saved for ${truck?.truckNumber ?? "the truck"}`);
      setDrafts([blankRow()]);
      setShowErrors(false);
    } else if (outcome.status === "refused") {
      setShowErrors(true);
      if (outcome.info.kind === ERROR_KIND.ARCHIVED_CUSTOMER) customers.reload();
      toast.error(`Not saved: ${outcome.info.message}`);
    } else if (outcome.status === "unknown") {
      toast.error("Could not confirm the save. Check below before doing anything else.");
    } else if (outcome.status === "invalid") {
      toast.error(`Not saved: ${outcome.error?.message ?? "the entry is not valid"}`);
    }
  };

  const discardPending = () => {
    flow.discard();
    setDrafts([blankRow()]);
    setShowErrors(false);
  };

  const enableInternal = async () => {
    try {
      await customers.enableInternal();
      toast.success("Internal / No Bill is available");
    } catch (error) {
      toast.error(error?.message ? `Could not enable Internal / No Bill: ${error.message}` : "Could not enable Internal / No Bill");
    }
  };

  const truckOptions = trucks.map((t) => ({
    value: t.id,
    label: `${t.truckNumber}${t.nickname ? ` (${t.nickname})` : ""}${t.model ? ` - ${t.model}` : ""}${t.status !== TRUCK_STATUS.WORKING ? ` [${TRUCK_STATUS_META[t.status].label}]` : ""}`,
  }));

  const loadProblem = truckStatus === "error" ? { text: `Could not load the trucks: ${truckLoadError}`, retry: reloadTrucks } : loadError ? { text: `Pheera records: ${loadError}`, retry: reloadPheeras } : customers.status === "error" ? { text: `Customers: ${customers.error}`, retry: customers.reload } : null;

  return (
    <div className="space-y-4 sm:space-y-5">
      {loadProblem && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-danger-soft px-4 py-3 text-sm text-danger">
          <span>{loadProblem.text}</span>
          <Button variant="outline" size="sm" onClick={loadProblem.retry}>
            Try again
          </Button>
        </div>
      )}

      {pending && (
        <div role="alert" className="space-y-2 rounded-lg border border-warning bg-warning-soft px-4 py-3 text-sm text-amber-800">
          <p className="font-semibold">The result of the last save is unknown.</p>
          <p>
            {pending.message} The server may or may not have saved this entry. It is locked so nothing changes. Press <strong>Retry save</strong>: the same entry is sent again with the same reference, so it can never be saved twice. Or check the saved list for
            this truck and date first.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={handleSave} loading={saving} disabled={saving}>
              Retry save
            </Button>
            <Button size="sm" variant="outline" onClick={reloadPheeras} disabled={saving}>
              Refresh saved list
            </Button>
            <Button size="sm" variant="ghost" onClick={discardPending} disabled={saving}>
              Discard this entry
            </Button>
          </div>
        </div>
      )}

      <fieldset disabled={locked} className="m-0 min-w-0 space-y-4 border-0 p-0 sm:space-y-5">
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
              onChange={(e) => setTruckPick(e.target.value)}
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
              <p className="text-xs text-fg-muted">Numbers {gaps.map((g) => `#${g}`).join(", ")} are missing (a Pheera was deleted). They are never reused.</p>
            </CardBody>
          )}
        </Card>
      )}

      <datalist id={MATERIAL_LIST_ID}>
        {customNames.map((m) => (
          <option key={m} value={m} />
        ))}
      </datalist>
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
            title={`Pheera ${i + 1}`}
            draft={d}
            errors={showErrors ? { ...(check.rowErrors[i] ?? {}), ...toFormErrors(serverErrors.rows[i]) } : {}}
            customerOptions={customerOptions}
            duplicateHint={duplicateHints[i]}
            onChange={(patch) => updateRow(d.key, patch)}
            onRemove={() => removeRow(d.key)}
          />
        ))}
        {drafts.length > 0 && <p className="type-small">Pheera numbers are given by the server when you save.</p>}
      </div>

      {!customers.internal && customers.status === "ready" && (
        <p className="flex flex-wrap items-center gap-2 text-sm text-fg-muted">
          &quot;Internal / No Bill&quot; (for the business&apos;s own trips, never invoiced) is not enabled.
          <Button variant="outline" size="sm" onClick={enableInternal} loading={customers.enabling} disabled={customers.enabling}>
            Enable Internal / No Bill
          </Button>
        </p>
      )}
      {customers.status === "ready" && customerList.length === 0 && <NoCustomersNotice internalAvailable={Boolean(internalCustomer)} />}
      </fieldset>

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
            <Button variant="outline" leftIcon={Plus} onClick={addRow} disabled={locked}>
              Add another Pheera
            </Button>
            <Button leftIcon={Save} onClick={handleSave} loading={saving} disabled={loading || drafts.length === 0 || customers.loading}>
              {saving ? "Saving..." : pending ? "Retry save" : `Save ${drafts.length} Pheera`}
            </Button>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
