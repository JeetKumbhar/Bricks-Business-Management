// Mirrors client/src/utils/paymentTypes.js. Same values, so the frontend needs no mapping.
// BOOKING_ADVANCE is the stored value; the interface calls it "Bayana".
export const PAYMENT_TYPES = Object.freeze({ BOOKING_ADVANCE: "BOOKING_ADVANCE", SALARY_PAYMENT: "SALARY_PAYMENT", OTHER: "OTHER" });
export const PAYMENT_TYPE_VALUES = Object.freeze(Object.values(PAYMENT_TYPES));

export const PAYMENT_METHODS = Object.freeze({ CASH: "CASH", UPI: "UPI", BANK: "BANK" });
export const PAYMENT_METHOD_VALUES = Object.freeze(Object.values(PAYMENT_METHODS));

// A worker (Bigari or Maapvali) or a Patlavale team / family. Worked out from the labour record, never sent by the client.
export const RECIPIENT_TYPES = Object.freeze({ WORKER: "WORKER", TEAM: "TEAM" });
export const RECIPIENT_TYPE_VALUES = Object.freeze(Object.values(RECIPIENT_TYPES));

// [OPEN with the client] Is Bayana always an advance against earnings? Should OTHER reduce the balance?
// Until answered, every type counts as received (same as the frontend's ACCOUNTING_POLICY). This is the ONLY place to change that.
export const ACCOUNTING_POLICY = Object.freeze({ bayanaCountsAsReceived: true, otherCountsAsReceived: true });

export const countsAsReceived = (type, policy = ACCOUNTING_POLICY) => {
  if (type === PAYMENT_TYPES.BOOKING_ADVANCE) return policy.bayanaCountsAsReceived;
  if (type === PAYMENT_TYPES.OTHER) return policy.otherCountsAsReceived;
  return true; // SALARY_PAYMENT
};

// Technical guards, not business rules: a typing slip such as an extra zero, and double-click protection.
export const MAX_PAYMENT_RUPEES = 10000000;
export const MAX_NOTE_LENGTH = 200;
export const MAX_REFERENCE_LENGTH = 60;
// With no requestId, an identical payment (same recipient, type, amount and date) created this soon after is treated as a double submit.
export const DUPLICATE_WINDOW_MS = 30000;
