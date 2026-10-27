// Mock labour records. Every record has a `labourType` and ONLY the rate field of its own type:
//   BIGARI    -> dailyRate
//   MAAPVALI  -> ratePerFourMaaps
//   PATLAVALE -> ratePer1000PayableBricks   (a family / team; `name` is the team name)
//
// `labourSeeds`      - Bigari numbers used to generate attendance + payments (attendance.js, payments.js)
// `maapvaliRecords`, `patlavaleRecords` - the other two types (used by maapEntries.js, production.js, payments.js)
// `initialLabours`   - all records of all types. Totals are never stored: they are calculated.
//
// IDs share one sequence: L-001..L-048 Bigari, L-049..L-054 Maapvali, L-055..L-058 Patlavale.
// All rates below for Maapvali and Patlavale are ILLUSTRATIVE, not agreed rates.
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
      labourType: "BIGARI",
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

const bigariRecords = labourSeeds.map(({ id, labourType, name, mobile, village, dailyRate, status, joiningDate }) => ({
  id,
  labourType,
  name,
  mobile,
  village,
  dailyRate,
  status,
  joiningDate,
  photo: null, // optional
}));

// Maapvali: individual workers, each with their own ratePerFourMaaps (rate per 4 maaps).
export const maapvaliRecords = [
  ["L-049", "Dattu Gaikwad", "9822001049", "Sinnar", 88, "ACTIVE", 90],
  ["L-050", "Baban Shinde", "9822001050", "Dindori", 96, "ACTIVE", 88],
  ["L-051", "Kailas More", "9822001051", "Niphad", 100, "ACTIVE", 85],
  ["L-052", "Sopan Pawar", "9822001052", "Igatpuri", 80, "ACTIVE", 80],
  ["L-053", "Ramdas Kale", "9822001053", "Yeola", 104, "INACTIVE", 78],
  ["L-054", "Anna Chavan", "9822001054", "Satana", 112, "ACTIVE", 60],
].map(([id, name, mobile, village, ratePerFourMaaps, status, joinedDaysAgo]) => ({
  id,
  labourType: "MAAPVALI",
  name,
  mobile,
  village,
  ratePerFourMaaps,
  status,
  joiningDate: daysAgo(joinedDaysAgo),
  photo: null,
}));

// Patlavale: one record per family / team. Members are optional reference details only.
export const patlavaleRecords = [
  ["L-055", "Ganpat Jadhav Family", "9822002055", "Sinnar", 650, 100, [["Ganpat Jadhav", "Head"], ["Sunita Jadhav", "Wife"], ["Rahul Jadhav", "Son"]]],
  ["L-056", "Bhika Waghmare Family", "9822002056", "Dindori", 700, 98, [["Bhika Waghmare", "Head"], ["Laxmi Waghmare", "Wife"]]],
  ["L-057", "Tukaram Gaikwad Family", "9822002057", "Niphad", 620, 95, []],
  ["L-058", "Shankar Kale Family", "9822002058", "Yeola", 680, 90, [["Shankar Kale", "Head"], ["Meena Kale", "Wife"], ["Vishal Kale", "Son"], ["Pooja Kale", "Daughter"]]],
].map(([id, name, mobile, village, ratePer1000PayableBricks, joinedDaysAgo, members]) => ({
  id,
  labourType: "PATLAVALE",
  name,
  mobile,
  village,
  ratePer1000PayableBricks,
  status: "ACTIVE",
  joiningDate: daysAgo(joinedDaysAgo),
  photo: null,
  ...(members.length ? { members: members.map(([memberName, relation]) => ({ name: memberName, relation })) } : {}),
}));

export const initialLabours = [...bigariRecords, ...maapvaliRecords, ...patlavaleRecords];
