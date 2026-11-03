// Mirrors client/src/utils/attendanceStatus.js. Same values, so the frontend needs no mapping.
export const ATTENDANCE_STATUS = Object.freeze({ PRESENT: "PRESENT", HALF_DAY: "HALF_DAY", ABSENT: "ABSENT" });
export const ATTENDANCE_STATUS_VALUES = Object.freeze(Object.values(ATTENDANCE_STATUS));

// Days of work each status counts for. Half a day is 0.5 [the half-day rule is still marked "waiting" with the client].
export const ATTENDANCE_UNITS = Object.freeze({ PRESENT: 1, HALF_DAY: 0.5, ABSENT: 0 });

// Most workers one "save the day" request may carry.
export const MAX_ENTRIES_PER_SAVE = 500;
