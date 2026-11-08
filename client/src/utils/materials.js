// Material rules for truck Pheera (trips). One place to change them.
//
//  - Bricks  -> "Number of Bricks", unit "bricks", whole numbers only.
//  - Sand, Stone, Khadi Matti, Grawal, Hard Murram, Soil -> "Weight (Tonnes)", unit "tonnes".
//  - Other   -> the user types the real material name (for example "Stone Dust"); "Weight (Tonnes)", unit "tonnes".
// A saved Pheera keeps the ACTUAL material name ("Stone Dust", never just "Other") together with its own unit.
// Bricks and tonnes are different units: they are NEVER added together anywhere in the app.
//
// Older records may carry names that are not offered any more (for example Cement). They are kept and shown exactly as
// saved, and any name other than "Bricks" is measured in tonnes (frontend-only compatibility, nothing is rewritten).

export const BRICKS = "Bricks";
export const SOIL = "Soil";
export const OTHER = "Other";

/** The standard materials, in dropdown order (anything else is typed by the user under "Other"). Used by the filters too. */
export const STANDARD_MATERIALS = [BRICKS, "Sand", "Stone", "Khadi Matti", "Grawal", "Hard Murram", SOIL];

/** What the material dropdown offers for a new entry. */
export const MATERIAL_CHOICES = [...STANDARD_MATERIALS, OTHER];

export const isStandardMaterial = (name) => STANDARD_MATERIALS.includes(name);

export const CUSTOM_MATERIAL_MAX = 40;

export const UNITS = { BRICKS: "bricks", TONNES: "tonnes" };

/** Sanity limits for ONE Pheera (one truck load). They catch typing mistakes such as an extra zero. */
export const MAX_BRICKS_PER_PHEERA = 100000;
export const MAX_TONNES_PER_PHEERA = 100;
export const TONNE_DECIMALS = 2;

export const isBricks = (material) => material === BRICKS;

/** The dropdown choice that a saved material name belongs to: a standard material, or "Other" (any other name). */
export const materialChoiceOf = (name) => (isStandardMaterial(name) ? name : OTHER);

/** For a custom name that is spelled like one already used (different capitals), reuse the existing spelling. */
export const matchKnownMaterial = (name, knownNames = []) => knownNames.find((k) => k.toLowerCase() === String(name).toLowerCase()) ?? name;

export const unitForMaterial = (material) => (isBricks(material) ? UNITS.BRICKS : UNITS.TONNES);

/** What the quantity field looks like for a material. */
export const quantityRule = (material) =>
  isBricks(material)
    ? { label: "Number of Bricks", unit: UNITS.BRICKS, integerOnly: true, max: MAX_BRICKS_PER_PHEERA, step: "1", inputMode: "numeric", placeholder: "e.g. 1500" }
    : { label: "Weight (Tonnes)", unit: UNITS.TONNES, integerOnly: false, max: MAX_TONNES_PER_PHEERA, step: "0.01", inputMode: "decimal", placeholder: "e.g. 4.5" };

/**
 * Parse what was typed into the quantity box.
 * -> { ok: true, value } or { ok: false, message }
 * Bricks: positive whole number. Tonnes: positive, at most 2 decimals.
 */
export const parseQuantity = (material, raw) => {
  const rule = quantityRule(material);
  const text = String(raw ?? "").trim();
  if (!text) return { ok: false, message: `Enter ${isBricks(material) ? "the number of bricks" : "the weight in tonnes"}` };

  if (rule.integerOnly) {
    if (!/^\d+$/.test(text)) return { ok: false, message: "Bricks must be a whole number (no decimals)" };
  } else {
    if (!/^(\d+\.?\d*|\.\d+)$/.test(text)) return { ok: false, message: "Enter the weight as a number, e.g. 4.5" };
    const decimals = (text.split(".")[1] ?? "").length;
    if (decimals > TONNE_DECIMALS) return { ok: false, message: `Weight can have at most ${TONNE_DECIMALS} decimal places` };
  }

  const value = Number(text);
  if (!Number.isFinite(value) || value <= 0) return { ok: false, message: "Quantity must be greater than 0" };
  if (value > rule.max) return { ok: false, message: `That is more than ${rule.max.toLocaleString("en-IN")} ${rule.unit} for one Pheera. Please check` };
  return { ok: true, value };
};

/** Show a stored quantity: bricks as a whole number, tonnes without useless zeros (4.5, 12, 0.25). */
export const formatQuantity = (quantity, unit) => {
  if (quantity === null || quantity === undefined || quantity === "") return "";
  const n = Number(quantity);
  return unit === UNITS.BRICKS
    ? n.toLocaleString("en-IN", { maximumFractionDigits: 0 })
    : n.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: TONNE_DECIMALS });
};

/** "1,500 bricks" / "4.5 tonnes" */
export const formatWithUnit = (quantity, unit) => `${formatQuantity(quantity, unit)} ${unit}`;
