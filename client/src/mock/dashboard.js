// Dashboard mock data. Labour, attendance, maap work, production and payments are NOT here any more:
// the dashboard calculates them from the same records the other pages use (see features/dashboard/dashboardSelectors.js),
// so the numbers always match. Only what has no module yet stays here (owner details and trucks).
import { toISODate } from "../utils/formatDate";

const daysAgo = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return toISODate(d);
};

export const dashboardData = {
  owner: { firstName: "Ramesh", fullName: "Ramesh Patel", role: "Owner" },

  // Replace with real truck data when the Trucks module is built.
  trucks: { total: 10, working: 7, stopped: 2, maintenance: 1 },

  truckAttention: [
    { id: "t1", truckNumber: "TRK-02", status: "STOPPED", reason: "Breakdown", since: daysAgo(1) },
    { id: "t2", truckNumber: "TRK-07", status: "STOPPED", reason: "Driver absent", since: daysAgo(0) },
    { id: "t3", truckNumber: "TRK-04", status: "MAINTENANCE", reason: "Engine service", since: daysAgo(2) },
  ],
};
