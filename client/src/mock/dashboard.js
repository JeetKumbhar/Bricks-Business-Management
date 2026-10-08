// Mock data for the Dashboard. Dates are relative to "today" so the demo never looks stale.
// Replace with API data (services/api.js) when the backend is ready - keep the same shape.
import { toISODate } from "../utils/formatDate";

const daysAgo = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return toISODate(d);
};
const hoursAgo = (h) => new Date(Date.now() - h * 3600 * 1000).toISOString();

export const dashboardData = {
  owner: { firstName: "Ramesh", fullName: "Ramesh Patel", role: "Owner" },

  summary: {
    totalLabour: 48,
    presentToday: 42,
    halfDayToday: 3,
    absentToday: 3,
    pendingSalary: 342800, // total unpaid balance across all labour (season to date)
    trucks: { total: 10, working: 7, stopped: 2, maintenance: 1 },
  },

  // Last 7 days, oldest first. The last entry is today and matches `summary`.
  weeklyAttendance: [
    { date: daysAgo(6), present: 34, halfDay: 5, absent: 9 },
    { date: daysAgo(5), present: 37, halfDay: 4, absent: 7 },
    { date: daysAgo(4), present: 36, halfDay: 5, absent: 7 },
    { date: daysAgo(3), present: 39, halfDay: 4, absent: 5 },
    { date: daysAgo(2), present: 44, halfDay: 2, absent: 2 },
    { date: daysAgo(1), present: 41, halfDay: 4, absent: 3 },
    { date: daysAgo(0), present: 42, halfDay: 3, absent: 3 },
  ],

  // Last 7 days of payments, split by type (see BUSINESS_RULES: all types count as "received").
  weeklyPayments: [
    { date: daysAgo(6), bookingAdvance: 0, salaryPayment: 12000, other: 0 },
    { date: daysAgo(5), bookingAdvance: 5000, salaryPayment: 9000, other: 0 },
    { date: daysAgo(4), bookingAdvance: 0, salaryPayment: 15500, other: 500 },
    { date: daysAgo(3), bookingAdvance: 10000, salaryPayment: 6000, other: 0 },
    { date: daysAgo(2), bookingAdvance: 0, salaryPayment: 21000, other: 1000 },
    { date: daysAgo(1), bookingAdvance: 2000, salaryPayment: 8500, other: 0 },
    { date: daysAgo(0), bookingAdvance: 0, salaryPayment: 3000, other: 0 },
  ],

  // No fixed salary week: this is a rolling "last 7 days" view.
  weeklySalary: {
    earned: 245600,
    overpaidLabours: 1, // balance below zero (shown in red)
  },

  truckAttention: [
    { id: "t1", truckNumber: "TRK-02", status: "STOPPED", reason: "Breakdown", since: daysAgo(1) },
    { id: "t2", truckNumber: "TRK-07", status: "STOPPED", reason: "Driver absent", since: daysAgo(0) },
    { id: "t3", truckNumber: "TRK-04", status: "MAINTENANCE", reason: "Engine service", since: daysAgo(2) },
  ],

  recentPayments: [
    { id: "p1", date: daysAgo(0), labourId: "L-002", labourName: "Suresh Singh", type: "SALARY_PAYMENT", amount: 1200 },
    { id: "p2", date: daysAgo(0), labourId: "L-001", labourName: "Ramesh Kumar", type: "SALARY_PAYMENT", amount: 1800 },
    { id: "p3", date: daysAgo(1), labourId: "L-007", labourName: "Ajay Kumar", type: "BOOKING_ADVANCE", amount: 2000 },
    { id: "p4", date: daysAgo(2), labourId: "L-004", labourName: "Vikash Yadav", type: "SALARY_PAYMENT", amount: 3000 },
    { id: "p5", date: daysAgo(2), labourId: "L-003", labourName: "Manoj Patel", type: "OTHER", amount: 500 },
  ],

  recentActivities: [
    { id: "a1", type: "attendance", title: "Attendance marked", detail: "42 present, 3 half day, 3 absent", time: hoursAgo(2) },
    { id: "a2", type: "payment", title: "Payment recorded", detail: "Suresh Singh - ₹1,200 (Salary payment)", time: hoursAgo(4) },
    { id: "a3", type: "truck", title: "Truck status updated", detail: "TRK-07 - Stopped (Driver absent)", time: hoursAgo(5) },
    { id: "a4", type: "labour", title: "New labour added", detail: "Mahesh Sawant", time: hoursAgo(6) },
    { id: "a5", type: "payment", title: "Booking advance given", detail: "Ajay Kumar - ₹2,000", time: hoursAgo(26) },
    { id: "a6", type: "attendance", title: "Attendance edited", detail: "Manoj Patel - Absent to Half Day", time: hoursAgo(30) },
  ],
};
