// Money is an INTEGER NUMBER OF PAISE (1 rupee = 100 paise) everywhere on the server: in memory, in MongoDB and in sums.
// Integers up to 9,007,199,254,740,991 are exact in JS, i.e. about ₹90 trillion, far above any real total here.
// Never add rupee amounts as floating-point numbers (0.1 + 0.2 !== 0.3). Convert at the edges only.
//
// RUPEES  <->  PAISE   : rupeesToPaise / paiseToRupees (API edge)
// MAAPS   ->   EARNINGS: earningsPaiseForMaaps (rate is per 4 maaps, every maap is paid proportionally)
//
// Rounding: when maaps x rate is not a whole number of paise (e.g. 1 maap at ₹88.50 per 4 = 22.125 rupees), the entry is
// rounded HALF UP to the nearest paise. That matches the current frontend (Math.round on paise) and is applied to each
// entry once; totals are then exact sums of those stored integers. [APPROVED 1 Nov 2026]
import ApiError from "./ApiError.js";

export const PAISE_PER_RUPEE = 100;
export const MAAPS_PER_RATE_UNIT = 4;
export const PAYABLE_BRICKS_PER_MAAP = 250;
export const PHYSICAL_BRICKS_PER_MAAP = 275;

export const isPaise = (value) => Number.isSafeInteger(value);

export const assertPaise = (value, name = "amount") => {
  if (!isPaise(value)) throw new RangeError(`${name} must be a whole number of paise (got ${value})`);
  return value;
};

/**
 * Exact conversion of a rupee amount to paise. Accepts a string ("1250.50") or a number (1250.5).
 * Rejects more than 2 decimal places instead of silently rounding, so a float artefact such as 0.1 + 0.2
 * ("0.30000000000000004") is an error, not a wrong amount.
 */
export const rupeesToPaise = (value, { allowNegative = false } = {}) => {
  const text = typeof value === "number" ? (Number.isFinite(value) ? String(value) : "") : String(value ?? "").trim();
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) throw new RangeError(`Invalid rupee amount: ${JSON.stringify(value)} (use at most 2 decimal places)`);

  const [, sign, whole, fraction = ""] = match;
  if (sign && !allowNegative) throw new RangeError(`Amount cannot be negative: ${JSON.stringify(value)}`);

  const paise = Number(whole) * PAISE_PER_RUPEE + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(paise)) throw new RangeError(`Amount is too large: ${JSON.stringify(value)}`);
  return sign ? -paise : paise;
};

/** Same as rupeesToPaise but throws a 400 ApiError, for request validation. */
export const parseRupeesInput = (value, field = "amount", options) => {
  try {
    return rupeesToPaise(value, options);
  } catch (err) {
    throw ApiError.badRequest("Validation failed", [{ field, message: err.message }]);
  }
};

/** Paise -> rupees as a number, for JSON output only (never add the results; add paise instead). */
export const paiseToRupees = (paise) => assertPaise(paise) / PAISE_PER_RUPEE;

/** Paise -> "2562.50" (exactly two decimals), for CSV and text. */
export const paiseToRupeeString = (paise) => {
  assertPaise(paise);
  const sign = paise < 0 ? "-" : "";
  const abs = Math.abs(paise);
  return `${sign}${Math.floor(abs / PAISE_PER_RUPEE)}.${String(abs % PAISE_PER_RUPEE).padStart(2, "0")}`;
};

/** Exact integer sum. */
export const sumPaise = (values = []) => values.reduce((total, value) => total + assertPaise(value), 0);

/** numerator / denominator rounded half up, using integers only (non-negative numerator, positive denominator). */
export const divideRoundHalfUp = (numerator, denominator) => {
  if (!Number.isSafeInteger(numerator) || numerator < 0) throw new RangeError(`numerator must be a whole number of 0 or more (got ${numerator})`);
  if (!Number.isSafeInteger(denominator) || denominator <= 0) throw new RangeError(`denominator must be a positive whole number (got ${denominator})`);
  const quotient = Math.floor(numerator / denominator);
  const remainder = numerator - quotient * denominator;
  return remainder * 2 >= denominator ? quotient + 1 : quotient;
};

/** Maapvali / Patlavale earnings in paise: maaps / 4 x rate per 4 maaps. No flooring to groups of 4. */
export const earningsPaiseForMaaps = (maaps, ratePerFourMaapsPaise) => {
  if (!Number.isSafeInteger(maaps) || maaps < 0) throw new RangeError(`maaps must be a whole number of 0 or more (got ${maaps})`);
  assertPaise(ratePerFourMaapsPaise, "rate");
  if (ratePerFourMaapsPaise < 0) throw new RangeError("rate cannot be negative");
  const product = maaps * ratePerFourMaapsPaise;
  if (!Number.isSafeInteger(product)) throw new RangeError("maaps x rate is too large");
  return divideRoundHalfUp(product, MAAPS_PER_RATE_UNIT);
};

/** Patlavale payable bricks: 250 per maap (4 maaps = 1,000). */
export const payableBricksForMaaps = (maaps) => {
  if (!Number.isSafeInteger(maaps) || maaps < 0) throw new RangeError(`maaps must be a whole number of 0 or more (got ${maaps})`);
  return maaps * PAYABLE_BRICKS_PER_MAAP;
};

/** Physical bricks: 275 per maap. Information only. */
export const physicalBricksForMaaps = (maaps) => {
  if (!Number.isSafeInteger(maaps) || maaps < 0) throw new RangeError(`maaps must be a whole number of 0 or more (got ${maaps})`);
  return maaps * PHYSICAL_BRICKS_PER_MAAP;
};
