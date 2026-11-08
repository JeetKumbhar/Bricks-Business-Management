// Read-side helpers for bills: totals, dashboard summary, search and filters. Pure functions.
import { BILL_STATUS } from "./billModel";
import { computeInvoice, deriveTaxType } from "./billCalculations";

/** Totals of a bill, always calculated from its items (never from a stored or typed total). Tax type comes from the state codes. */
export const billTotals = (bill) => computeInvoice(bill.items, bill.taxMode, deriveTaxType(bill.seller?.stateCode, bill.customer.stateCode));

/** What a bill is called on screen: its number, or "Draft" while it has none. */
export const billLabel = (bill) => bill.billNumber ?? "Draft";

/**
 * Dashboard numbers. Only FINALIZED bills count as invoiced: drafts are not sales yet and cancelled bills are not sales.
 */
export const summarizeBills = (bills) => {
  const count = (status) => bills.filter((b) => b.status === status).length;
  const finalized = bills.filter((b) => b.status === BILL_STATUS.FINAL);
  return {
    total: bills.length,
    draft: count(BILL_STATUS.DRAFT),
    finalized: finalized.length,
    cancelled: count(BILL_STATUS.CANCELLED),
    invoicedPaise: finalized.reduce((sum, b) => sum + billTotals(b).grandPaise, 0),
  };
};

/** filters: { search, from, to, status } - all optional and combined. Search matches bill number and customer name. */
export const filterBills = (bills, f = {}) => {
  const q = String(f.search ?? "").trim().toLowerCase();
  return bills.filter((b) => {
    if (f.status && b.status !== f.status) return false;
    if (f.from && b.billDate < f.from) return false;
    if (f.to && b.billDate > f.to) return false;
    if (q && !((b.billNumber ?? "").toLowerCase().includes(q) || b.customer.name.toLowerCase().includes(q))) return false;
    return true;
  });
};

/** Newest bill date first, then newest number (drafts, which have none, come first within a day). */
export const sortBills = (bills) => [...bills].sort((a, b) => b.billDate.localeCompare(a.billDate) || (b.billNumber ?? "￿").localeCompare(a.billNumber ?? "￿", undefined, { numeric: true }));

/** Customers seen on earlier bills, newest first, one per name (for the "choose a saved customer" list). */
export const knownCustomers = (bills) => {
  const seen = new Map();
  for (const b of sortBills(bills)) {
    const key = b.customer.name.trim().toLowerCase();
    if (key && !seen.has(key)) seen.set(key, b.customer);
  }
  return [...seen.values()];
};
