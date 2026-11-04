import { useSearchParams } from "react-router-dom";
import { Tabs } from "../components/ui";
import PeriodSelector from "../features/accounts/PeriodSelector";
import usePeriod from "../features/accounts/usePeriod";
import usePeriodAccounts from "../features/accounts/usePeriodAccounts";
import BigariReport from "../features/reports/BigariReport";
import MaapvaliReport from "../features/reports/MaapvaliReport";
import PatlavaleReport from "../features/reports/PatlavaleReport";
import PaymentsReport from "../features/reports/PaymentsReport";
import TruckReportsPanel from "../features/trucks/TruckReportsPanel";
import { useState } from "react";

const REPORTS = [
  { id: "bigari", label: "Bigari" },
  { id: "maapvali", label: "Maapvali" },
  { id: "patlavale", label: "Patlavale" },
  { id: "payments", label: "Payments" },
  { id: "trucks", label: "Trucks" },
];

/**
 * Reports for any date range (default: season to date), one per labour type plus Bayana and payment history.
 * Every report can be exported to CSV. Prototype calculations: final figures are calculated by the server.
 * "Trucks" holds the six transportation (Pheera) reports. They have their own date / truck / material / destination filters
 * and CSV, Excel and PDF export, so the labour period selector below is not shown for them.
 * /reports?report=trucks opens that tab directly (the single-truck page also passes &truck=<id>).
 */
export default function Reports() {
  const [params] = useSearchParams();
  const [report, setReport] = useState(() => (REPORTS.some((r) => r.id === params.get("report")) ? params.get("report") : "bigari"));
  const isTruck = report === "trucks";
  const { today, preset, setPreset, custom, setCustom, period } = usePeriod("SEASON");
  const { rows } = usePeriodAccounts(period.start, period.end);

  return (
    <div className="space-y-4 sm:space-y-5">
      <div>
        <h1 className="type-page-heading">Reports</h1>
        <p className="mt-1 text-sm text-fg-muted">Choose a report and a date range. Each report can be exported to CSV.</p>
      </div>

      {!isTruck && <PeriodSelector today={today} preset={preset} onPresetChange={setPreset} custom={custom} onCustomChange={setCustom} period={period} />}

      <div className="sticky top-16 z-20 -mx-4 bg-background px-4 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        <Tabs tabs={REPORTS} value={report} onChange={setReport} />
      </div>

      <div role="tabpanel">
        {report === "bigari" && <BigariReport key={`${period.start}|${period.end}`} rows={rows} period={period} />}
        {report === "maapvali" && <MaapvaliReport key={`${period.start}|${period.end}`} rows={rows} period={period} />}
        {report === "patlavale" && <PatlavaleReport key={`${period.start}|${period.end}`} rows={rows} period={period} />}
        {report === "payments" && <PaymentsReport period={period} />}
        {isTruck && <TruckReportsPanel />}
      </div>

      {!isTruck && <p className="type-small">Prototype calculation. Final figures are calculated by the server.</p>}
    </div>
  );
}
