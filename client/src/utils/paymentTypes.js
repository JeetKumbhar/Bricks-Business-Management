// Mirrors server/constants/paymentTypes.js
export const PAYMENT_TYPES = {
  BOOKING_ADVANCE: "BOOKING_ADVANCE",
  SALARY_PAYMENT: "SALARY_PAYMENT",
  OTHER: "OTHER",
};

// Label + Badge variant for each type
export const PAYMENT_TYPE_META = {
  // BOOKING_ADVANCE stays the stored value; the interface uses the client's familiar word "Bayana".
  BOOKING_ADVANCE: { label: "Bayana (Booking Advance)", shortLabel: "Bayana", variant: "info" },
  SALARY_PAYMENT: { label: "Salary Payment", shortLabel: "Salary", variant: "success" },
  OTHER: { label: "Other", shortLabel: "Other", variant: "neutral" },
};
