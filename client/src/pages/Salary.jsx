import { Download } from "lucide-react";
import { Button, useToast } from "../components/ui";
import PeriodSelector from "../features/accounts/PeriodSelector";
import usePeriod from "../features/accounts/usePeriod";
import usePeriodAccounts from "../features/accounts/usePeriodAccounts";
import SalaryTable from "../features/salary/SalaryTable";
import SalaryTypeSummary from "../features/salary/SalaryTypeSummary";
import SettlementNotice from "../features/salary/SettlementNotice";
import { workLine } from "../features/salary/workLine";
import { downloadCsv } from "../utils/exportCsv";
import { LABOUR_TYPE_META } from "../utils/labourTypes";

const CSV_HEADERS = ["Labour ID", "Name", "Type", "Work in range", "Earned (range)", "Received (range)", "Outstanding (season to date)"];

/**
 * Salary: earned, received and outstanding balances by labour type for ANY date range.
 * There is no fixed salary week. Outstanding is season to date and is never reset by a payment.
 * Prototype calculations: final financial calculations belong to the backend.
 */
export default function Salary() {
  const toast = useToast();
  const { today, preset, setPreset, custom, setCustom, period } = usePeriod("LAST7");
  const { rows, summary } = usePeriodAccounts(period.start, period.end);

  const handleExport = () => {
    const body = rows.map((r) => [
      r.id,
      r.name,
      LABOUR_TYPE_META[r.labourType].label,
      `${workLine(r).primary} (${workLine(r).secondary})`,
      r.period.earned,
      r.period.received,
      r.season.balance,
    ]);
    downloadCsv(`salary_${period.isSeason ? "season-to-date" : `${period.start}_to_${period.end}`}.csv`, CSV_HEADERS, body);
    toast.success("Salary exported");
  };

  return (
    <div className="space-y-4 sm:space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="type-page-heading">Salary</h1>
          <p className="mt-1 text-sm text-fg-muted">Earned, received and outstanding balances for any date range.</p>
        </div>
        <Button variant="outline" leftIcon={Download} onClick={handleExport} disabled={rows.length === 0} className="hidden sm:inline-flex">
          Export
        </Button>
      </div>

      <PeriodSelector
        today={today}
        preset={preset}
        onPresetChange={setPreset}
        custom={custom}
        onCustomChange={setCustom}
        period={period}
      />

      <SalaryTypeSummary summary={summary} />

      <Button variant="outline" leftIcon={Download} onClick={handleExport} disabled={rows.length === 0} fullWidth className="sm:hidden">
        Export to CSV
      </Button>

      <SalaryTable key={`${period.start}|${period.end}`} rows={rows} />

      <SettlementNotice />

      <p className="type-small">Prototype calculation. Final salary figures are calculated by the server.</p>
    </div>
  );
}
