// Compares the season-to-date figures the server calculated (GET /api/salary) with the ones the rest of the app calculates
// from the loaded records (earned, received, balance per labour). They should agree. A difference means a screen is showing a
// number that the server would not stand behind, so the Salary page says so instead of hiding it.
// Differences below the tolerance are rounding (the server works in whole paise per entry).

export const TOLERANCE = 0.5; // rupees

const close = (a, b) => Math.abs((a ?? 0) - (b ?? 0)) < TOLERANCE;

/**
 * serverRows: items of GET /api/salary. labours: the app's own labour records with earned / totalReceived / balance.
 * -> { checked, matching, differences: [{ id, name, field, server, app }] } (one entry per differing figure)
 */
export function reconcileBalances(serverRows, labours) {
  const byId = new Map(labours.map((l) => [l.id, l]));
  const differences = [];
  let matching = 0;

  for (const row of serverRows) {
    const app = byId.get(row.id);
    if (!app) {
      differences.push({ id: row.id, name: row.name, field: "missing in the app", server: row.season.balance, app: null });
      continue;
    }
    const pairs = [
      ["earned", row.season.earned, app.earned],
      ["received", row.season.received, app.totalReceived],
      ["balance", row.season.balance, app.balance],
    ];
    const bad = pairs.filter(([, server, mine]) => !close(server, mine));
    if (bad.length === 0) matching += 1;
    for (const [field, server, mine] of bad) differences.push({ id: row.id, name: row.name, field, server, app: mine });
  }

  // The server leaves out an inactive labour with nothing earned, paid or owed. If the app still shows a balance for one, that is a difference.
  const listed = new Set(serverRows.map((r) => r.id));
  for (const l of labours) {
    if (!listed.has(l.id) && !close(l.balance, 0)) differences.push({ id: l.id, name: l.name, field: "balance (not in the server's list)", server: 0, app: l.balance });
  }

  return { checked: serverRows.length, matching, differences };
}
