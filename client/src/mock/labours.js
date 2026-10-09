// Mock labour records.
//
// `labourSeeds`   - raw numbers used to generate attendance + payments (see attendance.js, payments.js)
// `initialLabours` - the labour records themselves (no totals: those are calculated from
//                    attendance, payments and rate history in features/labours/labourStats.js)
import { toISODate } from "../utils/formatDate";

const daysAgo = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return toISODate(d);
};
const makeId = (n) => `L-${String(n).padStart(3, "0")}`;

// [name, mobile, village, currentRate, present, half, absent, totalReceived, status, joinedDaysAgo]
const firstTen = [
  ["Ramesh Kumar", "9876543210", "Sinnar", 650, 22, 3, 2, 9000, "ACTIVE", 150],
  ["Suresh Singh", "9876123456", "Dindori", 700, 24, 1, 0, 12950, "ACTIVE", 148],
  ["Manoj Patel", "9765432109", "Niphad", 600, 20, 2, 1, 9500, "ACTIVE", 140],
  ["Vikash Yadav", "9654321098", "Igatpuri", 750, 25, 0, 3, 11250, "ACTIVE", 135],
  ["Deepak Sharma", "9543210987", "Yeola", 550, 21, 2, 1, 6600, "ACTIVE", 130],
  ["Pawan Tiwari", "9432109876", "Sinnar", 650, 18, 1, 4, 9175, "ACTIVE", 125],
  ["Ajay Kumar", "9321098765", "Chandwad", 700, 23, 1, 0, 11700, "ACTIVE", 120],
  ["Sanjay Gupta", "9210987654", "Satana", 600, 19, 3, 2, 8700, "ACTIVE", 118],
  ["Mahesh Sawant", "9109876543", "Dindori", 650, 0, 0, 0, 0, "INACTIVE", 110],
  ["Rohit Sharma", "9087654321", "Niphad", 700, 26, 0, 1, 10400, "ACTIVE", 100],
];

const firstNames = ["Anil", "Bharat", "Chandan", "Dinesh", "Ganesh", "Hari", "Imran", "Jagdish", "Kishan", "Lalit", "Mohan", "Naresh", "Om", "Prakash", "Rakesh", "Santosh", "Tukaram", "Umesh", "Vijay", "Yogesh"];
const lastNames = ["Patil", "Jadhav", "More", "Shinde", "Pawar", "Gaikwad", "Kale", "Bhosale", "Chavan", "Yadav", "Sharma", "Singh"];
const villages = ["Sinnar", "Dindori", "Niphad", "Igatpuri", "Yeola", "Chandwad", "Satana", "Ozar"];
const rates = [550, 600, 650, 700, 750];
const receivedFactors = [0.45, 0.6, 0.75, 0.9, 1.0, 1.1]; // 1.1 -> overpaid (negative balance)
const inactiveNumbers = [19, 25, 31, 37, 43];

// L-011 ... L-048, generated deterministically (no randomness, so the demo is stable).
const generated = Array.from({ length: 38 }, (_, k) => {
  const n = k + 11;
  const isNew = n >= 46; // L-046..L-048 joined recently ("New This Month")
  const rate = rates[n % rates.length];
  const present = isNew ? [5, 3, 1][n - 46] : 10 + ((n * 7) % 17);
  const half = isNew ? 0 : n % 4;
  const absent = isNew ? 0 : (n * 3) % 5;
  const earned = (present + half * 0.5) * rate;
  const received = isNew ? 2000 : Math.round((earned * receivedFactors[n % receivedFactors.length]) / 100) * 100;
  const mobilePrefix = [9, 8, 7, 9][n % 4];
  const mobileRest = String((n * 48271937) % 1_000_000_000).padStart(9, "0");

  return [
    `${firstNames[n % firstNames.length]} ${lastNames[(n * 3) % lastNames.length]}`,
    `${mobilePrefix}${mobileRest}`,
    villages[n % villages.length],
    rate,
    present,
    half,
    absent,
    received,
    inactiveNumbers.includes(n) ? "INACTIVE" : "ACTIVE",
    isNew ? [6, 3, 1][n - 46] : 20 + ((n * 11) % 120), // joined 6 / 3 / 1 days ago
  ];
});

export const labourSeeds = [...firstTen, ...generated].map(
  ([name, mobile, village, dailyRate, presentDays, halfDays, absentDays, totalReceived, status, joinedDaysAgo], index) => {
    // Everyone must have joined before their first attendance record (new joiners keep their short history).
    const needed = presentDays + halfDays + absentDays + (status === "INACTIVE" ? 7 : 0) + 5;
    return {
      id: makeId(index + 1),
      name,
      mobile,
      village,
      dailyRate, // current rate
      status,
      joiningDate: daysAgo(index >= 45 ? joinedDaysAgo : Math.max(joinedDaysAgo, needed)),
      presentDays,
      halfDays,
      absentDays,
      totalReceived,
    };
  }
);

export const initialLabours = labourSeeds.map(({ id, name, mobile, village, dailyRate, status, joiningDate }) => ({
  id,
  name,
  mobile,
  village,
  dailyRate,
  status,
  joiningDate,
  photo: null, // optional
}));
