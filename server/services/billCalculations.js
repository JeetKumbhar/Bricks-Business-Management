// Invoice arithmetic in INTEGERS (BigInt for the products, so nothing overflows or drifts).
//   quantity is stored in milli-units (2.5 tonnes = 2500), rate in paise per unit, tax rate in basis points (5.00 % = 500).
//   taxable   = round_half_up(quantityMilli x ratePaise / 1000)                       per line
//   IGST      = round_half_up(taxable x rateBp / 10000)                                per line
//   CGST,SGST = round_half_up(taxable x rateBp / 20000) each (half the rate)           per line
//   Totals are exact sums of the stored per-line integers, so the printed lines always add up to the printed totals.
// There is no automatic round-off line: the grand total is taxable + taxes to the paisa.
import { TAX_MODE, TAX_TYPE } from "../constants/bill.js";
import { PRICING_UNIT } from "../constants/billing.js";
import { MATERIAL_CATEGORY } from "../constants/truck.js";

const roundDiv = (numerator, denominator) => Number((numerator * 2n + denominator) / (denominator * 2n)); // half up, non-negative values

// pricingUnit PER_UNIT (default; every manual line): amount = quantity x rate. PER_THOUSAND (bricks lines from a Pheera): the rate is
// per 1,000 units, so amount = quantity / 1000 x rate. Rounded once, half up, to the paisa (25,000 bricks at 7,000 per 1,000 = 1,75,000.00).
export const lineTaxable = (quantityMilli, ratePaise, pricingUnit = PRICING_UNIT.PER_UNIT) =>
  roundDiv(BigInt(quantityMilli) * BigInt(ratePaise), pricingUnit === PRICING_UNIT.PER_THOUSAND ? 1_000_000n : 1000n);

/** The ONE place that decides how a Pheera's material is priced: bricks per 1,000, everything else per tonne. */
export const pricingUnitFor = (materialCategory) => (materialCategory === MATERIAL_CATEGORY.BRICKS ? PRICING_UNIT.PER_THOUSAND : PRICING_UNIT.PER_UNIT);
const taxOf = (taxable, rateBp, divisor) => roundDiv(BigInt(taxable) * BigInt(rateBp), BigInt(divisor));

/** Which tax applies: same state code = CGST + SGST, different = IGST, either missing = unknown (null). Never guessed. */
export const deriveTaxType = (sellerStateCode, customerStateCode) => {
  if (!sellerStateCode || !customerStateCode) return null;
  return sellerStateCode === customerStateCode ? TAX_TYPE.INTRA : TAX_TYPE.INTER;
};

/**
 * items: [{ quantityMilli, ratePaise, taxRateBp }] (missing numbers count as 0 so a draft can be saved half-filled).
 * Returns the calculated lines and totals. When GST applies but the tax type cannot be known yet, taxes stay 0 and taxPending is true.
 */
export const calculateBill = ({ items, taxMode, taxType }) => {
  const gst = taxMode === TAX_MODE.GST;
  const taxPending = gst && !taxType;
  const lines = items.map((item) => {
    const taxable = lineTaxable(item.quantityMilli ?? 0, item.ratePaise ?? 0, item.pricingUnit);
    const rateBp = gst ? (item.taxRateBp ?? 0) : 0;
    const apply = gst && !taxPending;
    const cgst = apply && taxType === TAX_TYPE.INTRA ? taxOf(taxable, rateBp, 20000) : 0;
    const sgst = cgst;
    const igst = apply && taxType === TAX_TYPE.INTER ? taxOf(taxable, rateBp, 10000) : 0;
    return { taxablePaise: taxable, cgstPaise: cgst, sgstPaise: sgst, igstPaise: igst, totalPaise: taxable + cgst + sgst + igst };
  });
  const sum = (key) => lines.reduce((total, line) => total + line[key], 0);
  const totals = { taxableTotalPaise: sum("taxablePaise"), cgstPaise: sum("cgstPaise"), sgstPaise: sum("sgstPaise"), igstPaise: sum("igstPaise") };
  return { lines, totals: { ...totals, grandTotalPaise: totals.taxableTotalPaise + totals.cgstPaise + totals.sgstPaise + totals.igstPaise }, taxPending };
};

/** Tax grouped by rate, for the totals block of the invoice: [{ rateBp, taxablePaise, cgstPaise, sgstPaise, igstPaise }]. */
export const taxByRate = (items) => {
  const groups = new Map();
  for (const item of items) {
    if (!item.taxRateBp) continue;
    const g = groups.get(item.taxRateBp) ?? { rateBp: item.taxRateBp, taxablePaise: 0, cgstPaise: 0, sgstPaise: 0, igstPaise: 0 };
    g.taxablePaise += item.taxablePaise;
    g.cgstPaise += item.cgstPaise;
    g.sgstPaise += item.sgstPaise;
    g.igstPaise += item.igstPaise;
    groups.set(item.taxRateBp, g);
  }
  return [...groups.values()].sort((a, b) => a.rateBp - b.rateBp);
};
