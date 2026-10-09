// Mirrors server/constants/attendance.js
export const ATTENDANCE_STATUS = {
  PRESENT: "PRESENT",
  HALF_DAY: "HALF_DAY",
  ABSENT: "ABSENT",
};

// PRESENT = 1 day, HALF_DAY = 0.5 day, ABSENT = 0 (docs/BUSINESS_RULES.md)
export const ATTENDANCE_UNITS = {
  PRESENT: 1,
  HALF_DAY: 0.5,
  ABSENT: 0,
};

export const ATTENDANCE_META = {
  PRESENT: { label: "Present", variant: "success" },
  HALF_DAY: { label: "Half Day", variant: "warning" },
  ABSENT: { label: "Absent", variant: "danger" },
};
