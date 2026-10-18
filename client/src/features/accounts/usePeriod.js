import { useMemo, useState } from "react";
import { resolvePeriod } from "../../utils/dateRanges";
import { addDaysISO, toISODate } from "../../utils/formatDate";

/** Selected date range: a preset (last 7 days, this week, ...) or a custom from / to. */
export default function usePeriod(defaultPreset = "LAST7") {
  const today = toISODate();
  const [preset, setPreset] = useState(defaultPreset);
  const [custom, setCustom] = useState({ start: addDaysISO(today, -6), end: today });
  const period = useMemo(() => resolvePeriod({ preset, custom, today }), [preset, custom, today]);
  return { today, preset, setPreset, custom, setCustom, period };
}
