import { Factory } from "lucide-react";
import { downloadCsv } from "../../utils/exportCsv";
import { formatCurrency, formatNumber } from "../../utils/formatCurrency";
import { LABOUR_TYPES } from "../../utils/labourTypes";
import ReportSection from "./ReportSection";
import { cardHeader, factGrid, money, nameCell } from "./reportParts";

/**
 * Patlavale teams: maaps, physical bricks, payable bricks, earnings, payments and balance.
 * Maaps, physical and payable bricks are separate columns.
 */
export default function PatlavaleReport({ rows, period }) {
  const data = rows.filter((r) => r.labourType === LABOUR_TYPES.PATLAVALE);
  const sum = (pick) => data.reduce((t, r) => t + pick(r), 0);

  const columns = [
    { key: "name", header: "Family / Team", render: nameCell },
    { key: "maaps", header: "Maaps", align: "right", render: (r) => formatNumber(r.period.work.maaps) },
    { key: "physical", header: "Physical bricks", align: "right", render: (r) => formatNumber(r.period.work.physicalBricks) },
    { key: "payable", header: "Payable bricks", align: "right", render: (r) => formatNumber(r.period.work.payableBricks) },
        { key: "earned", header: "Earnings", align: "right", render: (r) => formatCurrency(r.period.earned) },
    { key: "received", header: "Payments", align: "right", render: (r) => formatCurrency(r.period.received) },
    { key: "balance", header: "Balance (season)", align: "right", render: (r) => money(r.season.balance, "font-semibold") },
  ];

  const exportCsv = () =>
    downloadCsv(
      `patlavale-report_${period.isSeason ? "season" : `${period.start}_to_${period.end}`}.csv`,
      ["ID", "Team", "Maaps", "Physical bricks", "Payable bricks", "Earnings", "Payments", "Balance (season to date)"],
      data.map((r) => [r.id, r.name, r.period.work.maaps, r.period.work.physicalBricks, r.period.work.payableBricks, r.period.earned, r.period.received, r.season.balance])
    );

  return (
    <ReportSection
      title="Patlavale: Production, Payments and Balance"
      subtitle={period.label}
      icon={Factory}
      tiles={[
        { label: "Physical bricks", value: formatNumber(sum((r) => r.period.work.physicalBricks)) },
        { label: "Payable bricks", value: formatNumber(sum((r) => r.period.work.payableBricks)) },
        { label: "Maaps", value: formatNumber(sum((r) => r.period.work.maaps)) },
        { label: "Earnings", value: formatCurrency(sum((r) => r.period.earned)) },
      ]}
      columns={columns}
      data={data}
      onExport={exportCsv}
      note="Payable = 250 bricks for every maap (4 maaps = 1,000), earnings = maaps / 4 x team rate. Payments never change production."
      renderCard={(r) => (
        <div className="space-y-2.5">
          {cardHeader(r)}
          {factGrid([
            ["Physical bricks", formatNumber(r.period.work.physicalBricks)],
            ["Payable bricks", formatNumber(r.period.work.payableBricks)],
            ["Maaps", formatNumber(r.period.work.maaps)],
            ["Earnings", formatCurrency(r.period.earned)],
            ["Payments", formatCurrency(r.period.received)],
          ])}
        </div>
      )}
    />
  );
}
