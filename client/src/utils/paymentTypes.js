// Mirrors server/constants/paymentTypes.js
export const PAYMENT_TYPES = {
  BOOKING_ADVANCE: "BOOKING_ADVANCE",
  SALARY_PAYMENT: "SALARY_PAYMENT",
  OTHER: "OTHER",
};

// Label + Badge variant for each type
export const PAYMENT_TYPE_META = {
  BOOKING_ADVANCE: { label: "Booking Advance", variant: "info" },
  SALARY_PAYMENT: { label: "Salary Payment", variant: "success" },
  OTHER: { label: "Other", variant: "neutral" },
};
