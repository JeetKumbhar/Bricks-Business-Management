import { useMemo, useState } from "react";
import { BarChart3, Download } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { Button, Card, CardBody, CardHeader, DatePicker, EmptyState, Input, Select, Table, useToast } from "../../components/ui";
import { addDaysISO, formatDate } from "../../utils/formatDate";
import { todayBusinessDate } from "../../utils/businessDate";
import { formatQuantity, MATERIALS } from "../../utils/materials";
import { buildReport, REPORT_TYPES } from "./truckReports";
import { EXPORT_FORMATS, exportReport } from "./reportExport";
import useTruckTrips from "./useTruckTrips";

const PREVIEW_ROW_LIMIT = 500;

const COLUMNS = [
  { key: "businessDate", header: "Date", render: (r) => formatDate(r.businessDate) },
  { key: "registration", header: "Truck" },
  { key: "pheeraNumber", header: "Pheera", align: "right", render: (r) => `#${r.pheeraNumber}` },
  { key: "material", header: "Material" },
  { key: "destination", header: "Destination" },
  { key: "quantity", header: "Quantity", align: "right", render: (r) => `${formatQuantity(r.quantity, r.unit)} ${r.unit}` },
  { key: "remarks", header: "Remarks", className: "max-w-64 truncate", render: (r) => r.remarks || "-" },
];

const totalText = (t) => `${formatQuantity(t.quantity, t.unit)} ${t.unit} (${t.count} Pheera)`;

/** Show at most `limit` rows in the preview. The totals and the downloads always use every row. */
const limitSections = (sections, limit) => {
  let left = limit;
  let truncated = false;
  const out = [];
  for (const s of sections) {
    if (left <= 0) {
      truncated = true;
      break;
    }
    const rows = s.rows.slice(0, left);
    if (rows.length < s.rows.length) truncated = true;
    left -= rows.length;
    out.push({ ...s, shown: rows });
  }
  return { sections: out, truncated };
};

/** Pick a report and filters, see it on screen, then download it as CSV, Excel or PDF. */
export default function TruckReportsPanel() {
  const toast = useToast();
  const { trucks, rows, destinations } = useTruckTrips();
  const today = todayBusinessDate();

  const [searchParams] = useSearchParams();
  // /trucks?tab=reports&truck=<id> (from the single-truck page) opens the truck-wise report for that truck
  const linkedTruck = trucks.find((t) => t.id === searchParams.get("truck"));
  const [params, setParams] = useState(() => ({
    type: linkedTruck ? "truck" : "range",
    date: today,
    from: addDaysISO(today, -6),
    to: today,
    truckId: linkedTruck?.id ?? "",
    material: "",
    destination: "",
  }));
  const set = (patch) => setParams((p) => ({ ...p, ...patch }));

  const model = useMemo(() => buildReport({ rows, params, trucks }), [rows, params, trucks]);
  const type = REPORT_TYPES.find((t) => t.id === params.type);
  const single = params.type === "daily";
  const canExport = !model.error && model.count > 0;
  const preview = useMemo(() => (model.error ? null : limitSections(model.sections, PREVIEW_ROW_LIMIT)), [model]);

  const handleExport = (format) => {
    try {
      exportReport(model, format.id);
      toast.success(`${format.label} report downloaded`);
    } catch (error) {
      toast.error(error?.message ?? `Could not create the ${format.label} file`);
    }
  };

  return (
    <div className="space-y-4 sm:space-y-5">
      <Card>
        <CardHeader title="Truck reports" subtitle="Every report lists each Pheera, with subtotals and grand totals. Bricks and tonnes are never added together." icon={BarChart3} />
        <CardBody className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Select
              label="Report"
              value={params.type}
              onChange={(e) => set({ type: e.target.value })}
              options={REPORT_TYPES.map((t) => ({ value: t.id, label: t.label }))}
              hint={type ? `Needs: ${type.needs}` : undefined}
            />
            {single ? (
              <DatePicker label="Date" max={today} value={params.date} onChange={(e) => set({ date: e.target.value })} />
            ) : (
              <>
                <DatePicker label="From" max={today} value={params.from} onChange={(e) => set({ from: e.target.value })} />
                <DatePicker label="To" max={today} value={params.to} onChange={(e) => set({ to: e.target.value })} />
              </>
            )}
            <Select
              label="Truck"
              required={params.type === "truck"}
              placeholder="All trucks"
              value={params.truckId}
              onChange={(e) => set({ truckId: e.target.value })}
              options={trucks.map((t) => ({ value: t.id, label: t.nickname ? `${t.truckNumber} (${t.nickname})` : t.truckNumber }))}
            />
            <Select label="Material" placeholder="All materials" value={params.material} onChange={(e) => set({ material: e.target.value })} options={MATERIALS.map((m) => ({ value: m, label: m }))} />
            <Input label="Destination" list="report-destination-options" placeholder="All destinations" value={params.destination} onChange={(e) => set({ destination: e.target.value })} />
          </div>
          <datalist id="report-destination-options">
            {destinations.map((d) => (
              <option key={d} value={d} />
            ))}
          </datalist>
        </CardBody>
      </Card>

      {model.error ? (
        <Card>
          <EmptyState icon={BarChart3} title="Complete the filters" description={model.error} />
        </Card>
      ) : (
        <>
          <Card>
            <CardBody className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h2 className="type-card-heading">{model.title}</h2>
                <ul className="mt-1 text-sm text-fg-muted">
                  {model.filterLines.slice(0, 4).map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </div>
              <div className="flex flex-wrap gap-2">
                {EXPORT_FORMATS.map((f) => (
                  <Button key={f.id} variant={f.id === "pdf" ? "primary" : "outline"} leftIcon={Download} disabled={!canExport} onClick={() => handleExport(f)}>
                    {f.label}
                  </Button>
                ))}
              </div>
            </CardBody>
          </Card>

          {model.count === 0 ? (
            <Card>
              <EmptyState icon={BarChart3} title="No Pheera for these filters" description="Change the dates or filters to see a report." />
            </Card>
          ) : (
            <>
              {preview.sections.map((s) => (
                <Card key={s.heading}>
                  <CardHeader title={s.heading} subtitle={`${s.rows.length} Pheera`} />
                  <CardBody className="space-y-3">
                    <Table columns={COLUMNS} data={s.shown} rowKey="id" />
                    <p className="text-sm font-semibold">Subtotal: {s.totals.map(totalText).join("  |  ")}</p>
                  </CardBody>
                </Card>
              ))}
              {preview.truncated && <p className="type-small">The preview shows the first {PREVIEW_ROW_LIMIT} rows. Totals and downloads include every Pheera.</p>}

              <Card className="border-primary">
                <CardBody>
                  <p className="text-sm font-semibold text-fg-muted">Grand total - {model.count} Pheera</p>
                  <ul className="mt-1 space-y-0.5 text-lg font-bold">
                    {model.grand.totals.map((t) => (
                      <li key={t.unit}>{totalText(t)}</li>
                    ))}
                  </ul>
                </CardBody>
              </Card>
            </>
          )}
        </>
      )}
    </div>
  );
}
