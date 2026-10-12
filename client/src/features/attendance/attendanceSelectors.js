import { LABOUR_STATUS } from "../../utils/labourStatus";
import { LABOUR_TYPES } from "../../utils/labourTypes";

/** Attendance is recorded for BIGARI workers only. */
export const isBigari = (labour) => labour.labourType === LABOUR_TYPES.BIGARI;

/**
 * Who appears on a day's attendance sheet. Pass any list of labour records: other types are filtered out here.
 * - must be a Bigari worker (Maapvali are paid per maap and Patlavale teams by production, never by attendance)
 * - must have joined on or before that day
 * - must be active, OR already have a saved record that day (so old days stay editable)
 * `saved` is { [labourId]: status } for that day.
 */
export const getEligibleLabours = (labours, date, saved) =>
  labours.filter(
    (l) => isBigari(l) && l.joiningDate <= date && (l.status === LABOUR_STATUS.ACTIVE || Boolean(saved[l.id]))
  );

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

/** Active Maapvali workers and Patlavale teams: they are not on the attendance sheet. */
export const countExcludedTypes = (labours) => ({
  maapvali: labours.filter((l) => l.labourType === LABOUR_TYPES.MAAPVALI && l.status === LABOUR_STATUS.ACTIVE).length,
  patlavale: labours.filter((l) => l.labourType === LABOUR_TYPES.PATLAVALE && l.status === LABOUR_STATUS.ACTIVE).length,
});

/** Why the sheet is empty, in words the owner can act on. */
export const explainEmptyRoster = (labours) => {
  const bigari = labours.filter(isBigari);

  if (bigari.length === 0) {
    return {
      title: "No Bigari workers yet",
      description: "Attendance is only for Bigari workers. Add one in Labour Management to start marking attendance.",
    };
  }
  if (!bigari.some((l) => l.status === LABOUR_STATUS.ACTIVE)) {
    return {
      title: "No active Bigari workers",
      description: "Mark a Bigari worker as active in Labour Management to take attendance.",
    };
  }
  return {
    title: "No Bigari workers for this date",
    description: "No active Bigari worker had joined by this date. Try a later date.",
  };
};
