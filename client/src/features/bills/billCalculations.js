// All invoice arithmetic lives here (never repeated in components). It mirrors the backend (server/services/billCalculations.js)
// exactly, so a total shown here is the total the server will store. Money is integer paise.
//
//   amount of a line  = quantity x rate                    (rounded half up to the paisa)
//   IGST of a line    = amount x rate% / 100               (rounded half up, PER LINE)
//   CGST = SGST       = amount x rate% / 200 each          (rounded half up, PER LINE)
//   totals            = exact sums of the per-line integers; grand total = taxable + taxes, no round-off line
// Which tax applies comes from the state codes: same state = CGST + SGST, different state = IGST,
// a missing code = unknown (taxes stay 0 and `taxPending` is true). It is never guessed.
// Different units (bricks, tonnes ...) are never added together: only money is totalled.
import { parseScaled, roundDiv, trimNumber } from "../../utils/money";
import { TAX_MODE, TAX_TYPE } from "./billModel";

const QTY_DECIMALS = 3;
const RATE_DECIMALS = 2;
const PERCENT_DECIMALS = 2;

/** Row amount in paise from quantity and rate (numbers or typed text). null if either cannot be read. */
export const lineAmountPaise = (quantity, rate) => {
  const q = parseScaled(quantity, QTY_DECIMALS);
  const r = parseScaled(rate, RATE_DECIMALS);
  if (!q.ok || !r.ok) return null;
  // quantity has 10^3 scale and rate 10^2 scale: paise = quantityMilli x ratePaise / 1000
  return roundDiv(BigInt(q.scaled) * BigInt(r.scaled), 1000);
};

/** GST rate in hundredths of a percent (18 -> 1800). null if it cannot be read (blank counts as unreadable). */
export const rateBasisPoints = (taxRate) => {
  const p = parseScaled(taxRate, PERCENT_DECIMALS);
  return p.ok ? p.scaled : null;
};

/** Label for a rate shown on the invoice: 250 -> "2.5" */
export const percentText = (bp) => trimNumber(bp / 100);

/** Same state = CGST + SGST (INTRA), different state = IGST (INTER), a code missing = null (not known yet). */
export const deriveTaxType = (sellerStateCode, customerStateCode) => {
  const seller = String(sellerStateCode ?? "").trim();
  const customer = String(customerStateCode ?? "").trim();
  if (!seller || !customer) return null;
  return seller === customer ? TAX_TYPE.INTRA : TAX_TYPE.INTER;
};

/**
 * items: [{ quantity, rate, taxRate }] (numbers or typed text; a blank counts as 0 so a half-filled draft still totals)
 * -> { taxMode, taxType, taxPending, lines: [{ amountPaise, taxRateBp, cgstPaise, sgstPaise, igstPaise, totalPaise }],
 *      taxablePaise, slabs (for the "taxed at different rates" note), cgstPaise, sgstPaise, igstPaise, taxPaise, grandPaise,
 *      cgstRateText, sgstRateText, igstRateText }
 */
export const computeInvoice = (items, taxMode, taxType) => {
  const gst = taxMode === TAX_MODE.GST;
  const taxPending = gst && !taxType;
  const apply = gst && !taxPending;
  const lines = items.map((item) => {
    const amountPaise = lineAmountPaise(item.quantity, item.rate) ?? 0;
    const taxRateBp = gst ? (rateBasisPoints(item.taxRate) ?? 0) : 0;
    const cgstPaise = apply && taxType === TAX_TYPE.INTRA ? roundDiv(BigInt(amountPaise) * BigInt(taxRateBp), 20000) : 0;
    const igstPaise = apply && taxType === TAX_TYPE.INTER ? roundDiv(BigInt(amountPaise) * BigInt(taxRateBp), 10000) : 0;
    return { amountPaise, taxRateBp, cgstPaise, sgstPaise: cgstPaise, igstPaise, totalPaise: amountPaise + cgstPaise * 2 + igstPaise };
  });
  const sum = (key) => lines.reduce((total, l) => total + l[key], 0);
  const taxablePaise = sum("amountPaise");
  const cgstPaise = sum("cgstPaise");
  const sgstPaise = sum("sgstPaise");
  const igstPaise = sum("igstPaise");

  // one slab per distinct GST rate (display only: the amounts above are per line)
  const byRate = new Map();
  for (const l of lines) if (l.taxRateBp > 0) byRate.set(l.taxRateBp, (byRate.get(l.taxRateBp) ?? 0) + l.amountPaise);
  const slabs = [...byRate].sort((a, b) => a[0] - b[0]).map(([rateBp, taxable]) => ({ rateBp, taxablePaise: taxable }));
  const rateText = (divisor) => (!apply || slabs.length === 0 ? "" : slabs.length === 1 ? percentText(slabs[0].rateBp / divisor) : "mixed");

  return {
    taxMode,
    taxType: gst ? taxType ?? null : null,
    taxPending,
    lines,
    taxablePaise,
    slabs,
    cgstPaise,
    sgstPaise,
    igstPaise,
    taxPaise: cgstPaise + sgstPaise + igstPaise,
    grandPaise: taxablePaise + cgstPaise + sgstPaise + igstPaise,
    cgstRateText: rateText(2),
    sgstRateText: rateText(2),
    igstRateText: rateText(1),
  };
};
