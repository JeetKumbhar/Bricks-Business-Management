// One implementation of "one row per rostered worker / team for the selected date", shared by the Maapvali and
// Patlavale daily sheets. Pure functions. Each row depends only on its own maaps and rate (no carry-forward), so search
// and filters can never change a calculation. Blank = not entered; 0 = an explicit zero.
import { parseDailyMaaps } from "../../../utils/dailyWorkCalculations";

/**
 * config: {
 *   idKey:      entry field holding the worker / team id ("labourId" | "teamId")
 *   enteredKey: entry field holding the maaps typed that day ("numberOfMaaps" | "newMaaps")
 *   rateOf:     (workerOrTeam) => current rate per 4 maaps
 *   savedRateOf:(entry) => the rate snapshot stored on a saved entry
 *   calculate:  ({ maapsEntered, ratePerFourMaaps }) => calculation
 * }
 * entries: every live entry.   draft: { [id]: { maaps?: string, note?: string } } typed since the last save.
 */
export const buildDailyRows = ({ roster, entries, date, draft, config }) => {
  const { idKey, enteredKey, rateOf, savedRateOf, calculate } = config;
  const savedBy = {};
  entries.filter((e) => e.date === date).forEach((e) => (savedBy[e[idKey]] = e));

  return roster.map((owner) => {
    const saved = savedBy[owner.id] ?? null;
    const d = draft[owner.id] ?? {};
    const text = d.maaps ?? (saved ? String(saved[enteredKey]) : "");
    const note = d.note ?? saved?.note ?? "";
    const parsed = parseDailyMaaps(text);
    const rate = saved ? savedRateOf(saved) : rateOf(owner);

    let error = null;
    if (parsed.status === "error") error = parsed.message;
    else if (parsed.status === "blank" && saved) error = "Enter 0 for no work (or delete it from history)";

    const calc = parsed.status === "ok" ? calculate({ maapsEntered: parsed.value, ratePerFourMaaps: rate }) : null;
    const dirty = parsed.status === "ok" && (!saved || saved[enteredKey] !== parsed.value || (saved.note ?? "") !== note.trim());

    return { owner, worker: owner, saved, text, note, error, calc, rate, dirty, entered: parsed.status === "ok" };
  });
};

/** Tile numbers for the selected date, over every rostered row (search / filter never change them). */
export const summarizeDay = (rows) => {
  const entered = rows.filter((r) => r.calc);
  return {
    maaps: entered.reduce((t, r) => t + r.calc.maapsEntered, 0),
    payableBricks: entered.reduce((t, r) => t + (r.calc.payableBricks ?? 0), 0),
    earnings: entered.reduce((t, r) => t + r.calc.earnings, 0),
    entered: entered.length,
    notEntered: rows.length - entered.length,
    total: rows.length,
  };
};
