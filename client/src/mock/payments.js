// Payment records generated so each labour's payments add up to `totalReceived` in mock/labours.js.
// Shape: { id, labourId, date, type: BOOKING_ADVANCE | SALARY_PAYMENT | OTHER, amount, method, note, isDeleted }
import { toISODate } from "../utils/formatDate";
import { labourSeeds } from "./labours";

const daysAgo = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return toISODate(d);
};

const generatedPayments = labourSeeds.flatMap((seed, index) => {
  const total = seed.totalReceived;
  if (!total) return [];

  const offset = seed.status === "INACTIVE" ? 7 : 0;
  const advance = total >= 6000 ? 3000 : total >= 3000 ? 2000 : total;

  const records = [
    {
      id: `pay-${seed.id}-0`,
      labourId: seed.id,
      date: seed.joiningDate,
      type: "BOOKING_ADVANCE",
      amount: advance,
      method: "CASH",
      note: "",
      isDeleted: false,
    },
  ];

  const remaining = total - advance;
  if (remaining > 0) {
    const count = Math.min(5, Math.max(1, Math.ceil(remaining / 3500)));
    const base = Math.floor(remaining / count / 50) * 50;

    for (let i = 0; i < count; i += 1) {
      let date = daysAgo(offset + 2 + (count - 1 - i) * 7); // oldest first, one a week
      if (date < seed.joiningDate) date = seed.joiningDate;
      records.push({
        id: `pay-${seed.id}-${i + 1}`,
        labourId: seed.id,
        date,
        type: "SALARY_PAYMENT",
        amount: i === count - 1 ? remaining - base * (count - 1) : base,
        method: (i + index) % 4 === 3 ? "UPI" : "CASH",
        note: "",
        isDeleted: false,
      });
    }
  }

  return records;
});

// A few "Other" payments (a note is required for these).
const otherPayments = [
  { labourId: "L-002", ago: 4, amount: 500, note: "Medical help" },
  { labourId: "L-005", ago: 9, amount: 300, note: "Festival gift" },
  { labourId: "L-010", ago: 2, amount: 1000, note: "Phone repair" },
].map((p, i) => ({
  id: `pay-other-${i}`,
  labourId: p.labourId,
  date: daysAgo(p.ago),
  type: "OTHER",
  amount: p.amount,
  method: "CASH",
  note: p.note,
  isDeleted: false,
}));

export const initialPayments = [...generatedPayments, ...otherPayments];
