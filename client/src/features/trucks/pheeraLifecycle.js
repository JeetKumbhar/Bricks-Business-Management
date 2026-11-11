import { materialChoiceOf, OTHER } from "../../utils/materials";

// Lifecycle of a Pheera as the screens show it (pure functions). The SERVER decides what is allowed: these helpers only choose which
// buttons to offer and never convert a missing (null) billing status into "not billed".
//   billingStatus: null (older record) | UNBILLED | RESERVED | BILLED | NOT_BILLABLE;  isVoided: true when voided.

export const LIFECYCLE = {
  VOIDED: { label: "Voided", variant: "danger" },
  UNBILLED: { label: "Not billed", variant: "info" },
  RESERVED: { label: "In draft bill", variant: "warning" },
  BILLED: { label: "Billed", variant: "success" },
  NOT_BILLABLE: { label: "No bill (internal)", variant: "neutral" },
  HISTORICAL: { label: "Older record", variant: "neutral" },
};

export const isVoidedRecord = (r) => Boolean(r.isVoided || r.isDeleted);

export const lifecycleKey = (r) => (isVoidedRecord(r) ? "VOIDED" : (LIFECYCLE[r.billingStatus] ? r.billingStatus : "HISTORICAL"));
export const lifecycleMeta = (r) => LIFECYCLE[lifecycleKey(r)];

/** Locked by the server: in a draft bill or billed. */
export const isLockedRecord = (r) => !isVoidedRecord(r) && (r.billingStatus === "RESERVED" || r.billingStatus === "BILLED");

/** Which actions to OFFER (the server still checks every one). Release is only for a billed Pheera, whose invoice must be cancelled. */
export function availableActions(r) {
  if (isVoidedRecord(r)) return { correct: false, assign: false, release: false, void: false };
  const locked = isLockedRecord(r);
  return { correct: !locked, assign: !locked, release: r.billingStatus === "BILLED", void: !locked };
}

/** Why an action is not offered (for a tooltip). */
export const lockedReason = (r) =>
  isVoidedRecord(r) ? "Voided: this Pheera can no longer be changed"
  : r.billingStatus === "RESERVED" ? "Locked: this Pheera is in a draft bill"
  : r.billingStatus === "BILLED" ? "Locked: this Pheera is in a bill (billed). Cancel the invoice, then release it"
  : "";

/** Only the fields that really changed: { material?, destination?, quantity?, remarks? }. Quantity is re-sent whenever the material changes. */
export function correctionChanges(record, form) {
  const changes = {};
  const same = (a, b) => String(a ?? "").trim() === String(b ?? "").trim();
  const materialChanged = !same(record.material, form.material);
  if (materialChanged) changes.material = form.material;
  if (!same(record.destination, form.destination)) changes.destination = form.destination;
  if (materialChanged || Number(form.quantity) !== Number(record.quantity) || String(form.quantity).trim() === "") changes.quantity = form.quantity;
  if (!same(record.remarks, form.remarks)) changes.remarks = form.remarks;
  // a quantity-only "change" that is identical to the saved value is not a change
  if (!materialChanged && Object.keys(changes).length === 1 && "quantity" in changes && String(form.quantity).trim() !== "" && Number(form.quantity) === Number(record.quantity)) return {};
  return changes;
}

/** The correction form values a record starts with. */
export const correctionDefaults = (r) => ({ material: materialChoiceOf(r.material), customName: materialChoiceOf(r.material) === OTHER ? r.material : "", destination: r.destination, quantity: String(r.quantity), remarks: r.remarks ?? "", reason: "" });
