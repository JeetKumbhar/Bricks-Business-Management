// PROTOTYPE calculations (frontend only). Final financial calculations belong to the backend.
// Patlavale production totals. The per-entry maths (maaps -> payable bricks and earnings) lives in dailyWorkCalculations.js.
// There is no carry-forward: every recorded maap is payable (250 payable bricks per maap).

/** Season totals for one team from its entries. Payments never change these. */
export const summarizeProduction = (entries = []) => ({
  totalMaaps: entries.reduce((total, e) => total + e.newMaaps, 0),
  totalPhysicalBricks: entries.reduce((total, e) => total + e.newPhysicalBricks, 0),
  totalPayableBricks: entries.reduce((total, e) => total + e.newPayableBricks, 0),
  totalEarnings: entries.reduce((total, e) => total + e.newEarnings, 0),
});
