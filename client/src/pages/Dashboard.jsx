import AttendanceSummary from "../features/dashboard/AttendanceSummary";
import DashboardStats from "../features/dashboard/DashboardStats";
import PaymentSummary from "../features/dashboard/PaymentSummary";
import RecentActivities from "../features/dashboard/RecentActivities";
import RecentPayments from "../features/dashboard/RecentPayments";
import TruckStatus from "../features/dashboard/TruckStatus";
import useDashboardData from "../features/dashboard/useDashboardData";
import WeeklySalarySummary from "../features/dashboard/WeeklySalarySummary";
import { formatLongDate, getGreeting } from "../utils/formatDate";

export default function Dashboard() {
  const data = useDashboardData();
  const now = new Date();

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="type-page-heading">
            {getGreeting(now)}, {data.owner.firstName}!
          </h1>
          <p className="mt-1 text-sm text-fg-muted">Here's what's happening with your business today.</p>
        </div>
        <p className="text-sm font-medium text-fg-muted">{formatLongDate(now)}</p>
      </div>

      <DashboardStats summary={data.summary} weeklyPaymentsTotal={data.weeklyPaymentsTotal} />

      <div className="grid gap-5 lg:grid-cols-3">
        <AttendanceSummary data={data.weeklyAttendance} className="lg:col-span-2" />
        <TruckStatus trucks={data.summary.trucks} attention={data.truckAttention} />

        <PaymentSummary data={data.weeklyPayments} className="lg:col-span-2" />
        <WeeklySalarySummary
          earned={data.weeklySalary.earned}
          paid={data.weeklyPaymentsTotal}
          pendingBalance={data.summary.pendingSalary}
          overpaidLabours={data.weeklySalary.overpaidLabours}
        />

        <RecentPayments payments={data.recentPayments} className="lg:col-span-2" />
        <RecentActivities activities={data.recentActivities} />
      </div>
    </div>
  );
}
