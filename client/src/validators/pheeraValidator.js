// Validation for Pheera (truck trip) entry. Plain functions (no schema library) so the same rules can be reused by the
// service layer and by tests. The server must repeat these checks when the backend exists.
import { isBusinessDate } from "../utils/businessDate";
import { MATERIALS, parseQuantity, unitForMaterial } from "../utils/materials";

export const DESTINATION_MIN = 2;
export const DESTINATION_MAX = 60;
export const REMARKS_MAX = 200;

export const normalizeText = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

/** An untouched, blank row. */
export const emptyDraft = () => ({ material: "", destination: "", quantity: "", remarks: "" });

/**
 * One draft row: { material, destination, quantity (typed text), remarks }.
 * -> { errors: { material?, destination?, quantity?, remarks? }, value | null }
 * `value` is the cleaned row: { material, destination, quantity (number), unit, remarks }.
 */
export const validatePheeraDraft = (draft) => {
  const errors = {};
  const material = String(draft?.material ?? "");
  const destination = normalizeText(draft?.destination);
  const remarks = normalizeText(draft?.remarks);

  if (!MATERIALS.includes(material)) errors.material = "Choose a material";
  if (destination.length < DESTINATION_MIN) errors.destination = "Enter the destination";
  else if (destination.length > DESTINATION_MAX) errors.destination = `Destination is too long (max ${DESTINATION_MAX})`;
  if (remarks.length > REMARKS_MAX) errors.remarks = `Remarks are too long (max ${REMARKS_MAX})`;

  let quantity = null;
  if (MATERIALS.includes(material)) {
    const parsed = parseQuantity(material, draft?.quantity);
    if (parsed.ok) quantity = parsed.value;
    else errors.quantity = parsed.message;
  } else if (!errors.material) {
    errors.quantity = "Choose a material first";
  } else {
    errors.quantity = "Choose a material, then enter the quantity";
  }

  if (Object.keys(errors).length > 0) return { errors, value: null };
  return { errors, value: { material, destination, quantity, unit: unitForMaterial(material), remarks } };
};

/** Date + truck for the whole batch. `today` is the IST business date. -> { businessDate?, truckId? } */
export const validateEntryContext = ({ businessDate, truckId, today, trucks }) => {
  const errors = {};
  if (!isBusinessDate(businessDate)) errors.businessDate = "Choose a valid date";
  else if (businessDate > today) errors.businessDate = "The date cannot be in the future";
  if (!truckId || !trucks.some((t) => t.id === truckId)) errors.truckId = "Choose a truck";
  return errors;
};

/**
 * Whole batch (what one Save click sends).
 * -> { valid, contextErrors, rowErrors: [{...} per row], values: [cleaned rows], message }
 */
export const validateBatch = ({ businessDate, truckId, today, trucks, drafts }) => {
  const contextErrors = validateEntryContext({ businessDate, truckId, today, trucks });
  const results = drafts.map(validatePheeraDraft);
  const rowErrors = results.map((r) => r.errors);
  const noRows = drafts.length === 0;
  const valid = !noRows && Object.keys(contextErrors).length === 0 && results.every((r) => r.value);
  let message = null;
  if (noRows) message = "Add at least one Pheera before saving";
  else if (Object.keys(contextErrors).length > 0) message = "Check the date and truck";
  else if (!valid) message = "Some rows need attention. Fix them or remove them, then save again";
  return { valid, contextErrors, rowErrors, values: valid ? results.map((r) => r.value) : [], message };
};
