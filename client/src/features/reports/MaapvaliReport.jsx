import { Boxes } from "lucide-react";
import { downloadCsv } from "../../utils/exportCsv";
import { formatCurrency, formatNumber } from "../../utils/formatCurrency";
import { LABOUR_TYPES } from "../../utils/labourTypes";
import ReportSection from "./ReportSection";
import { cardHeader, factGrid, money, nameCell } from "./reportParts";

/** Maapvali: maaps and earnings in the range, money received in the range, balance season to date. */
export default function MaapvaliReport({ rows, period }) {
  const data = rows.filter((r) => r.labourType === LABOUR_TYPES.MAAPVALI);
  const sum = (pick) => data.reduce((t, r) => t + pick(r), 0);

  const columns = [
    { key: "name", header: "Maapvali", render: nameCell },
    { key: "maaps", header: "Maaps", align: "right", render: (r) => formatNumber(r.period.work.maaps) },
    { key: "days", header: "Work days", align: "right", render: (r) => r.period.work.workDays },
    { key: "earned", header: "Earned", align: "right", render: (r) => formatCurrency(r.period.earned) },
    { key: "received", header: "Received", align: "right", render: (r) => formatCurrency(r.period.received) },
    { key: "balance", header: "Balance (season)", align: "right", render: (r) => money(r.season.balance, "font-semibold") },
  ];

  const exportCsv = () =>
    downloadCsv(
      `maapvali-report_${period.isSeason ? "season" : `${period.start}_to_${period.end}`}.csv`,
      ["ID", "Name", "Maaps", "Work days", "Earned", "Received", "Balance (season to date)"],
      data.map((r) => [r.id, r.name, r.period.work.maaps, r.period.work.workDays, r.period.earned, r.period.received, r.season.balance])
    );

  return (
    <ReportSection
      title="Maapvali: Maaps and Earnings"
      subtitle={period.label}
      icon={Boxes}
      tiles={[
        { label: "Workers", value: data.length },
        { label: "Maaps", value: formatNumber(sum((r) => r.period.work.maaps)) },
        { label: "Earned", value: formatCurrency(sum((r) => r.period.earned)) },
        { label: "Received", value: formatCurrency(sum((r) => r.period.received)) },
      ]}
      columns={columns}
      data={data}
      onExport={exportCsv}
      note="Earnings = maaps x each worker's rate per maap. Balance is season to date."
      renderCard={(r) => (
        <div className="space-y-2.5">
          {cardHeader(r)}
          {factGrid([
            ["Maaps", formatNumber(r.period.work.maaps)],
            ["Work days", r.period.work.workDays],
            ["Earned", formatCurrency(r.period.earned)],
            ["Received", formatCurrency(r.period.received)],
          ])}
        </div>
      )}
    />
  );
}
