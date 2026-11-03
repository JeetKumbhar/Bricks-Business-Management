// Material catalogue and quantity rules for truck Pheera (trips). One place to change them.
//
// Confirmed with the client:
//  - Bricks      -> "Number of Bricks", unit "bricks", whole numbers only.
//  - Everything else -> "Weight (Tonnes)", unit "tonnes". No kg / quintal.
// Bricks and tonnes are different units: they are NEVER added together anywhere in the app.

export const BRICKS = "Bricks";

/** Add a material here to make it selectable. Any name other than "Bricks" is measured in tonnes. */
export const MATERIALS = ["Bricks", "Sand", "Cement", "Stone"];

export const UNITS = { BRICKS: "bricks", TONNES: "tonnes" };

/** Sanity limits for ONE Pheera (one truck load). They catch typing mistakes such as an extra zero. */
export const MAX_BRICKS_PER_PHEERA = 100000;
export const MAX_TONNES_PER_PHEERA = 100;
export const TONNE_DECIMALS = 2;

export const isBricks = (material) => material === BRICKS;

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
