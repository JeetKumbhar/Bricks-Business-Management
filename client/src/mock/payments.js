// Payment records generated so each labour's payments add up to `totalReceived` in mock/labours.js.
// Shape: { id, labourId, date, type: BOOKING_ADVANCE | SALARY_PAYMENT | OTHER, amount, method, note, isDeleted }
import { toISODate } from "../utils/formatDate";
import { labourSeeds, maapvaliRecords, patlavaleRecords } from "./labours";

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

// Payments to Maapvali workers and Patlavale teams (amounts are illustrative).
// [recipientId, bayana, [[daysAgo, amount], ...salary payments]]
const otherTypePayments = [
  ["L-049", 2000, [[20, 1500], [9, 1500]]],
  ["L-050", 2000, [[18, 3500]]],
  ["L-051", 2500, [[15, 2000], [6, 2500]]],
  ["L-052", 3000, [[12, 3500]]], // paid slightly more than earned so far: shows an overpaid (red) balance
  ["L-053", 2000, [[22, 2500], [9, 3000]]],
  ["L-054", 2000, [[5, 1800]]],
  ["L-055", 8000, [[40, 5000], [14, 4000]]],
  ["L-056", 10000, [[35, 5000], [10, 3000]]],
  ["L-057", 6000, [[30, 4000]]],
  ["L-058", 8000, [[28, 5000], [7, 4000]]],
].flatMap(([recipientId, bayana, salaries]) => {
  const labour = [...maapvaliRecords, ...patlavaleRecords].find((l) => l.id === recipientId);
  const recipientType = labour.labourType === "PATLAVALE" ? "TEAM" : "WORKER";
  const make = (suffix, date, type, amount) => ({
    id: `pay-${recipientId}-${suffix}`,
    labourId: recipientId, // legacy alias, same as recipientId
    recipientType,
    recipientId,
    date,
    type,
    amount,
    method: "CASH",
    note: "",
    isDeleted: false,
  });
  return [
    make("bayana", labour.joiningDate, "BOOKING_ADVANCE", bayana),
    ...salaries.map(([ago, amount], i) => make(`s${i + 1}`, daysAgo(ago), "SALARY_PAYMENT", amount)),
  ];
});

// Every payment names its recipient. Bigari payments are to a WORKER.
const withRecipient = (p) => ({ recipientType: "WORKER", recipientId: p.labourId, ...p });

// More examples so every kind of record is represented:
//  - "Other" payments for a Maapvali worker and a Patlavale team (a note is required for Other)
//  - one corrected payment: it keeps its revision history (what it was before, why it changed)
//  - one deleted payment: it stays on record with its reason, and is ignored in every balance
const otherExamples = [
  ["L-051", 4, 300, "Medical help"],
  ["L-057", 8, 500, "Diesel for tractor"],
].map(([recipientId, ago, amount, note], i) => ({
  id: `pay-${recipientId}-other${i + 1}`,
  labourId: recipientId, // legacy alias, same as recipientId
  recipientType: recipientId === "L-057" ? "TEAM" : "WORKER",
  recipientId,
  date: daysAgo(ago),
  type: "OTHER",
  amount,
  method: "CASH",
  note,
  isDeleted: false,
}));

const deletedExample = {
  id: "pay-L-056-deleted",
  labourId: "L-056",
  recipientType: "TEAM",
  recipientId: "L-056",
  date: daysAgo(12),
  type: "SALARY_PAYMENT",
  amount: 4000,
  method: "CASH",
  note: "Entered twice",
  isDeleted: true,
  deletedReason: "Duplicate entry",
  deletedAt: new Date(Date.now() - 11 * 24 * 3600 * 1000).toISOString(),
};

const withHistory = (p) =>
  p.id === "pay-L-050-s1"
    ? {
        ...p, // amount is 3,500 now; it was typed as 3,000 first
        editedReason: "Amount was typed wrongly",
        updatedAt: new Date(Date.now() - 16 * 24 * 3600 * 1000).toISOString(),
        revisions: [
          {
            changedAt: new Date(Date.now() - 16 * 24 * 3600 * 1000).toISOString(),
            changedBy: "Ramesh Patel",
            reason: "Amount was typed wrongly",
            before: { type: p.type, amount: 3000, date: p.date, note: p.note },
          },
        ],
      }
    : p;

export const initialPayments = [
  ...[...generatedPayments, ...otherPayments].map(withRecipient),
  ...otherTypePayments,
  ...otherExamples,
  deletedExample,
].map(withHistory);
