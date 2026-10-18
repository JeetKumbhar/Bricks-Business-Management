import { CalendarCheck } from "lucide-react";
import { downloadCsv } from "../../utils/exportCsv";
import { formatCurrency } from "../../utils/formatCurrency";
import { LABOUR_TYPES } from "../../utils/labourTypes";
import ReportSection from "./ReportSection";
import { cardHeader, factGrid, money, nameCell } from "./reportParts";

/** Bigari: attendance and earnings in the range, money received in the range, balance season to date. */
export default function BigariReport({ rows, period }) {
  const data = rows.filter((r) => r.labourType === LABOUR_TYPES.BIGARI);
  const sum = (pick) => data.reduce((t, r) => t + pick(r), 0);

  const columns = [
    { key: "name", header: "Bigari", render: nameCell },
    { key: "present", header: "Present", align: "right", render: (r) => r.period.work.presentDays },
    { key: "half", header: "Half days", align: "right", render: (r) => r.period.work.halfDays },
    { key: "absent", header: "Absent", align: "right", render: (r) => r.period.work.absentDays },
    { key: "units", header: "Working units", align: "right", render: (r) => r.period.work.workingUnits },
    { key: "earned", header: "Earned", align: "right", render: (r) => formatCurrency(r.period.earned) },
    { key: "received", header: "Received", align: "right", render: (r) => formatCurrency(r.period.received) },
    { key: "balance", header: "Balance (season)", align: "right", render: (r) => money(r.season.balance, "font-semibold") },
  ];

  const exportCsv = () =>
    downloadCsv(
      `bigari-report_${period.isSeason ? "season" : `${period.start}_to_${period.end}`}.csv`,
      ["ID", "Name", "Present days", "Half days", "Absent days", "Working units", "Earned", "Received", "Balance (season to date)"],
      data.map((r) => [r.id, r.name, r.period.work.presentDays, r.period.work.halfDays, r.period.work.absentDays, r.period.work.workingUnits, r.period.earned, r.period.received, r.season.balance])
    );

  return (
    <ReportSection
      title="Bigari: Attendance and Earnings"
      subtitle={period.label}
      icon={CalendarCheck}
      tiles={[
        { label: "Workers", value: data.length },
        { label: "Working units", value: sum((r) => r.period.work.workingUnits) },
        { label: "Earned", value: formatCurrency(sum((r) => r.period.earned)) },
        { label: "Received", value: formatCurrency(sum((r) => r.period.received)) },
      ]}
      columns={columns}
      data={data}
      onExport={exportCsv}
      note="Earned uses the rate in force on each day. Balance is season to date."
      renderCard={(r) => (
        <div className="space-y-2.5">
          {cardHeader(r)}
          {factGrid([
            ["Present / half / absent", `${r.period.work.presentDays} / ${r.period.work.halfDays} / ${r.period.work.absentDays}`],
            ["Working units", r.period.work.workingUnits],
            ["Earned", formatCurrency(r.period.earned)],
            ["Received", formatCurrency(r.period.received)],
          ])}
        </div>
      )}
    />
  );
}
