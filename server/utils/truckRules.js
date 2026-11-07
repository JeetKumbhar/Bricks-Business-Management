// Pure rules for trucks and Pheera records (no database), shared by the request validators and the services.
import {
  MATERIAL_CATEGORY,
  MATERIAL_RULES,
  MAX_BRICKS_PER_PHEERA,
  MAX_MATERIAL_NAME,
  MAX_TONNES_PER_PHEERA,
  MAX_TONNE_DECIMALS,
  MIN_MATERIAL_NAME,
  RESERVED_MATERIAL_KEYS,
  UNITS,
} from "../constants/truck.js";

export const normalizeText = (value) => String(value ?? "").trim().replace(/\s+/g, " ");
/** Case-insensitive key: "palghar" and "Palghar " are the same destination, "stone dust" and "Stone  Dust" the same material. */
export const textKey = (value) => normalizeText(value).toLowerCase();
export const normalizeTruckNumber = (value) => normalizeText(value).toUpperCase();
/** "MH-04 AB 1234" and "mh04ab1234" are the same truck: compare registration numbers by this key. */
export const truckNumberKey = (value) => String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
export const escapeRegExp = (text) => String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Tonnes are added as whole kilograms so 0.1 + 0.2 is exactly 0.3. */
export const toMilli = (value) => Math.round(Number(value) * 1000);
export const fromMilli = (milli) => milli / 1000;

/** The unit that goes with a material category. */
export const unitForCategory = (category) => MATERIAL_RULES[category].unit;

/** Is `quantity` valid for `unit`? Returns an error message or null. Quantities are JSON numbers, never text. */
export const quantityError = (quantity, unit) => {
  if (typeof quantity !== "number" || !Number.isFinite(quantity)) return "Quantity must be a number";
  if (unit === UNITS.BRICKS) {
    if (!Number.isInteger(quantity)) return "Bricks must be a whole number";
    if (quantity < 1) return "Must be at least 1 brick";
    if (quantity > MAX_BRICKS_PER_PHEERA) return `Cannot be more than ${MAX_BRICKS_PER_PHEERA} bricks`;
    return null;
  }
  if (quantity <= 0) return "Weight must be greater than 0";
  if (quantity > MAX_TONNES_PER_PHEERA) return `Cannot be more than ${MAX_TONNES_PER_PHEERA} tonnes`;
  if (Math.abs(toMilli(quantity) - quantity * 1000) > 1e-6) return `Use at most ${MAX_TONNE_DECIMALS} decimal places`;
  return null;
};

/**
 * Checks the material part of a Pheera and works out what is stored.
 *   BRICKS -> name "Bricks", bricks, whole number      SOIL -> name "Soil", tonnes
 *   OTHER  -> the real custom name (trimmed, not empty, not a standard name), tonnes
 * input: { material, customMaterialName, quantity, unit }. Returns { value } or { errors: { field: message } }.
 */
export const resolveTripMaterial = ({ material, customMaterialName, quantity, unit }) => {
  const errors = {};
  const rule = MATERIAL_RULES[material];
  if (!rule) return { errors: { material: "Choose Bricks, Soil or Other" } };

  const custom = normalizeText(customMaterialName);
  let name = rule.name;
  if (material === MATERIAL_CATEGORY.OTHER) {
    name = custom;
    if (custom.length < MIN_MATERIAL_NAME) errors.customMaterialName = "Enter the material name";
    else if (custom.length > MAX_MATERIAL_NAME) errors.customMaterialName = "Material name is too long";
    else if (RESERVED_MATERIAL_KEYS.includes(textKey(custom))) errors.customMaterialName = "Choose Bricks or Soil instead of typing that name";
  } else if (custom) {
    errors.customMaterialName = "A custom name is only used for Other";
  }

  if (unit !== undefined && unit !== rule.unit) errors.unit = `${rule.name ?? "This material"} is counted in ${rule.unit}`;
  const problem = quantityError(quantity, rule.unit);
  if (problem) errors.quantity = problem;

  if (Object.keys(errors).length) return { errors };
  return { value: { materialCategory: material, materialName: name, materialKey: textKey(name), unit: rule.unit, quantity } };
};
