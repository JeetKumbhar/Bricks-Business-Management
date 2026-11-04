import { Card, CardBody, DatePicker, Input, SearchInput, Select, Tabs } from "../../components/ui";
import { DATE_PRESETS, detectPreset, presetRange } from "./pheeraFilterPresets";

/**
 * `materials` = the names the material filter offers (Bricks, Soil and every other saved name, see materialFilterOptions).
 * Filters for Pheera lists: quick date ranges, from / to, truck, material, destination, and a search box
 * (registration number, nickname, destination, remarks). Controlled: `filters` and `onChange(nextFilters)`.
 */
export default function PheeraFilters({ filters, onChange, trucks, destinations, materials, today, hideTruck = false }) {
  const set = (patch) => onChange({ ...filters, ...patch });
  const preset = detectPreset(filters.from, filters.to, today);
  const rangeError = filters.from && filters.to && filters.to < filters.from ? "The end date is before the start date." : null;

  return (
    <Card>
      <CardBody className="space-y-3">
        <Tabs variant="pills" tabs={DATE_PRESETS} value={preset} onChange={(id) => set(presetRange(id, today))} />

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <DatePicker label="From" max={today} value={filters.from} onChange={(e) => set({ from: e.target.value })} />
          <DatePicker label="To" max={today} value={filters.to} onChange={(e) => set({ to: e.target.value })} />
          {!hideTruck && (
            <Select
              label="Truck"
              placeholder="All trucks"
              value={filters.truckId}
              onChange={(e) => set({ truckId: e.target.value })}
              options={trucks.map((t) => ({ value: t.id, label: t.nickname ? `${t.truckNumber} (${t.nickname})` : t.truckNumber }))}
            />
          )}
          <Select
            label="Material"
            placeholder="All materials"
            value={filters.material}
            onChange={(e) => set({ material: e.target.value })}
            options={materials.map((m) => ({ value: m, label: m }))}
          />
          <Input
            label="Destination"
            placeholder="All destinations"
            list="pheera-destination-options"
            value={filters.destination}
            onChange={(e) => set({ destination: e.target.value })}
            wrapperClassName="col-span-2 lg:col-span-1"
          />
        </div>
        <datalist id="pheera-destination-options">
          {destinations.map((d) => (
            <option key={d} value={d} />
          ))}
        </datalist>

        <SearchInput value={filters.search} onChange={(v) => set({ search: v })} placeholder="Search truck number, nickname, destination or remarks..." />
        {rangeError && (
          <p role="alert" className="text-xs text-danger">
            {rangeError}
          </p>
        )}
      </CardBody>
    </Card>
  );
}
