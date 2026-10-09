// Daily attendance records generated from the counts in mock/labours.js.
// Shape: { id, labourId, date: "YYYY-MM-DD", status: PRESENT | HALF_DAY | ABSENT }
import { toISODate } from "../utils/formatDate";
import { labourSeeds } from "./labours";

const daysAgo = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return toISODate(d);
};

// Tiny seeded random generator so the shuffle is the same on every load.
const makeRng = (seed) => () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};

const shuffle = (items, rand) => {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

export const initialAttendance = labourSeeds.flatMap((seed, index) => {
  const statuses = shuffle(
    [
      ...Array(seed.presentDays).fill("PRESENT"),
      ...Array(seed.halfDays).fill("HALF_DAY"),
      ...Array(seed.absentDays).fill("ABSENT"),
    ],
    makeRng(index + 7)
  );
  const offset = seed.status === "INACTIVE" ? 7 : 0; // inactive labour stopped coming a week ago

  return statuses.map((status, i) => ({
    id: `att-${seed.id}-${i}`,
    labourId: seed.id,
    date: daysAgo(offset + 1 + i), // starts yesterday: today is left unmarked so you can try the daily screen
    status,
  }));
});
