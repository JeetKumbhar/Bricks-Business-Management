// Validation for Pheera (truck trip) entry. Plain functions (no schema library) so the same rules can be reused by the
// service layer and by tests. The server must repeat these checks when the backend exists.
import { isBusinessDate } from "../utils/businessDate";
import { CUSTOM_MATERIAL_MAX, MATERIAL_CHOICES, OTHER, STANDARD_MATERIALS, isStandardMaterial, parseQuantity, unitForMaterial } from "../utils/materials";

export const DESTINATION_MIN = 2;
export const DESTINATION_MAX = 60;
export const REMARKS_MAX = 200;

export const normalizeText = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

/** An untouched, blank row. */
// material = the dropdown choice (a standard material or Other); customMaterial = the typed name when the choice is Other
export const emptyDraft = () => ({ material: "", customMaterial: "", destination: "", quantity: "", remarks: "" });

/** The real material name of a draft: the standard material chosen, or the trimmed custom name. "" when not known yet. */
export const resolveMaterialName = (draft) => {
  const choice = String(draft?.material ?? "");
  return choice === OTHER ? normalizeText(draft?.customMaterial) : isStandardMaterial(choice) ? choice : "";
};

/**
 * One draft row: { material (a standard material | Other), customMaterial, destination, quantity (typed text), remarks }.
 * -> { errors: { material?, customMaterial?, destination?, quantity?, remarks? }, value | null }
 * `value` is the cleaned row: { material (the real name), destination, quantity (number), unit, remarks }.
 */
export const validatePheeraDraft = (draft) => {
  const errors = {};
  const choice = String(draft?.material ?? "");
  const material = resolveMaterialName(draft);
  const destination = normalizeText(draft?.destination);
  const remarks = normalizeText(draft?.remarks);

  if (!MATERIAL_CHOICES.includes(choice)) errors.material = "Choose a material";
  if (choice === OTHER) {
    const lower = material.toLowerCase();
    if (!material) errors.customMaterial = "Enter the material name";
    else if (material.length > CUSTOM_MATERIAL_MAX) errors.customMaterial = `Material name is too long (max ${CUSTOM_MATERIAL_MAX})`;
    else if (lower === "other") errors.customMaterial = "Enter the actual material name, not Other";
    else {
      const listed = STANDARD_MATERIALS.find((m) => m.toLowerCase() === lower);
      if (listed) errors.customMaterial = `Choose ${listed} from the list`;
    }
  }
  if (destination.length < DESTINATION_MIN) errors.destination = "Enter the destination";
  else if (destination.length > DESTINATION_MAX) errors.destination = `Destination is too long (max ${DESTINATION_MAX})`;
  if (remarks.length > REMARKS_MAX) errors.remarks = `Remarks are too long (max ${REMARKS_MAX})`;

  // "Other" is always tonnes, so its quantity is checked even before the name is typed
  let quantity = null;
  const quantityMaterial = choice === OTHER ? OTHER : material; // typed names are always tonnes
  if (quantityMaterial) {
    const parsed = parseQuantity(quantityMaterial, draft?.quantity);
    if (parsed.ok) quantity = parsed.value;
    else errors.quantity = parsed.message;
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
