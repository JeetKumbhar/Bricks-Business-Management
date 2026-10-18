import { CalendarRange } from "lucide-react";
import { Card, CardBody, DatePicker, Tabs } from "../../components/ui";
import { PERIOD_PRESETS } from "../../utils/dateRanges";

/** Presets (last 7 days, this week, this month, season to date) or a custom from / to range. */
export default function PeriodSelector({ today, preset, onPresetChange, custom, onCustomChange, period }) {
  return (
    <Card>
      <CardBody className="space-y-3">
        <Tabs variant="pills" tabs={PERIOD_PRESETS} value={preset} onChange={onPresetChange} />

        {preset === "CUSTOM" && (
          <div className="grid grid-cols-2 gap-3">
            <DatePicker label="From" max={today} value={custom.start} onChange={(e) => onCustomChange({ ...custom, start: e.target.value })} />
            <DatePicker label="To" max={today} value={custom.end} onChange={(e) => onCustomChange({ ...custom, end: e.target.value })} />
          </div>
        )}

        <p className="flex items-center gap-2 text-sm font-medium" aria-live="polite">
          <CalendarRange className="h-4 w-4 text-fg-muted" aria-hidden="true" />
          {period.label}
        </p>
        {period.error && <p className="text-xs text-danger">{period.error}</p>}
        <p className="type-small">There is no fixed salary week: choose any range.</p>
      </CardBody>
    </Card>
  );
}
