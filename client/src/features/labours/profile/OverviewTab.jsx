import AttendanceStatsCard from "./AttendanceStatsCard";
import FinancialSummaryCard from "./FinancialSummaryCard";
import LabourDetailsCard from "./LabourDetailsCard";

export default function OverviewTab({ labour }) {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <LabourDetailsCard labour={labour} />
      <div className="space-y-4 lg:col-span-2">
        <AttendanceStatsCard labour={labour} />
        <FinancialSummaryCard labour={labour} />
      </div>
    </div>
  );
}
