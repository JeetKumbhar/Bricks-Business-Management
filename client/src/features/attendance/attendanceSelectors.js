import { LABOUR_STATUS } from "../../utils/labourStatus";

/**
 * Who appears on a day's attendance sheet:
 * - must have joined on or before that day
 * - must be active, OR already have a saved record that day (so old days stay editable)
 * `saved` is { [labourId]: status } for that day.
 */
export const getEligibleLabours = (labours, date, saved) =>
  labours.filter((l) => l.joiningDate <= date && (l.status === LABOUR_STATUS.ACTIVE || Boolean(saved[l.id])));

/** Counts for the summary bar. statusOf(id) returns PRESENT | HALF_DAY | ABSENT | null. */
export const summarize = (labours, statusOf) => {
  const counts = { present: 0, halfDay: 0, absent: 0, unmarked: 0 };
  labours.forEach((l) => {
    const status = statusOf(l.id);
    if (status === "PRESENT") counts.present += 1;
    else if (status === "HALF_DAY") counts.halfDay += 1;
    else if (status === "ABSENT") counts.absent += 1;
    else counts.unmarked += 1;
  });
  return counts;
};
