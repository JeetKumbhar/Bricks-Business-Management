// Pheera <-> Bills integration (Phase 2).
// Billing status of a Pheera. Historical Pheeras (saved before the integration) have NO status (null): they are neither billable nor locked.
//   UNBILLED     a normal customer's Pheera that can be put on an invoice
//   RESERVED     held by a DRAFT bill (locked: cannot be edited, voided or reassigned)
//   BILLED       on a FINALIZED bill (locked; stays BILLED even if that invoice is later cancelled, until explicitly released or re-billed)
//   NOT_BILLABLE the built-in "Internal / No Bill" customer (own use, wastage). Never offered for, and never accepted into, an invoice.
export const BILLING_STATUS = Object.freeze({ UNBILLED: "UNBILLED", RESERVED: "RESERVED", BILLED: "BILLED", NOT_BILLABLE: "NOT_BILLABLE" });
export const BILLING_STATUS_VALUES = Object.freeze(Object.values(BILLING_STATUS));
export const LOCKED_BILLING_STATUSES = Object.freeze([BILLING_STATUS.RESERVED, BILLING_STATUS.BILLED]);

export const BILLING_ACTION = Object.freeze({
  RESERVED: "RESERVED", RELEASED: "RELEASED", BILLED: "BILLED", BILL_CANCELLED: "BILL_CANCELLED", REBILLED: "REBILLED", CUSTOMER_ASSIGNED: "CUSTOMER_ASSIGNED",
});
export const BILLING_ACTION_VALUES = Object.freeze(Object.values(BILLING_ACTION));

// How a bill line's rate is read: per unit (every manual line, tonnes) or per 1,000 (bricks lines generated from a Pheera).
export const PRICING_UNIT = Object.freeze({ PER_UNIT: "PER_UNIT", PER_THOUSAND: "PER_THOUSAND" });
export const PRICING_UNIT_VALUES = Object.freeze(Object.values(PRICING_UNIT));

export const MAX_TRIPS_PER_BILL_REQUEST = 100;
