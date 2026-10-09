import { useMemo, useState } from "react";
import { CalendarDays } from "lucide-react";
import Pagination from "../../../components/common/Pagination";
import ResponsiveTable from "../../../components/common/ResponsiveTable";
import { Badge, Card, CardBody, CardHeader, Tabs } from "../../../components/ui";
import { ATTENDANCE_META } from "../../../utils/attendanceStatus";
import { formatCurrency } from "../../../utils/formatCurrency";
import { formatDate, formatShortWeekday } from "../../../utils/formatDate";

const PAGE_SIZE = 15;

const columns = [
  {
    key: "date",
    header: "Date",
    render: (r) => (
      <span>
        {formatDate(r.date)} <span className="type-small">({formatShortWeekday(r.date)})</span>
      </span>
    ),
  },
  {
    key: "status",
    header: "Status",
    render: (r) => <Badge variant={ATTENDANCE_META[r.status].variant}>{ATTENDANCE_META[r.status].label}</Badge>,
  },
  { key: "units", header: "Units", align: "right" },
  { key: "rate", header: "Rate", align: "right", render: (r) => formatCurrency(r.rate) },
  { key: "earned", header: "Earned", align: "right", className: "font-semibold", render: (r) => formatCurrency(r.earned) },
];

/** Day-by-day attendance with the rate that applied on each day. */
export default function AttendanceTab({ records }) {
  const [filter, setFilter] = useState("ALL");
  const [page, setPage] = useState(1);

  const counts = useMemo(
    () => ({
      ALL: records.length,
      PRESENT: records.filter((r) => r.status === "PRESENT").length,
      HALF_DAY: records.filter((r) => r.status === "HALF_DAY").length,
      ABSENT: records.filter((r) => r.status === "ABSENT").length,
    }),
    [records]
  );

  const filtered = filter === "ALL" ? records : records.filter((r) => r.status === filter);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const rows = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const tabs = [
    { id: "ALL", label: "All", count: counts.ALL },
    { id: "PRESENT", label: "Present", count: counts.PRESENT },
    { id: "HALF_DAY", label: "Half Day", count: counts.HALF_DAY },
    { id: "ABSENT", label: "Absent", count: counts.ABSENT },
  ];

  return (
    <Card>
      <CardHeader title="Attendance Records" subtitle={`${filtered.length} days`} icon={CalendarDays} />
      <CardBody className="space-y-4">
        <Tabs
          variant="pills"
          tabs={tabs}
          value={filter}
          onChange={(id) => {
            setFilter(id);
            setPage(1);
          }}
        />

        <ResponsiveTable
          columns={columns}
          data={rows}
          renderCard={(r) => (
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium">{formatDate(r.date)}</p>
                <p className="type-small">
                  {formatShortWeekday(r.date)} - {formatCurrency(r.rate)} / day
                </p>
              </div>
              <div className="text-right">
                <Badge variant={ATTENDANCE_META[r.status].variant}>{ATTENDANCE_META[r.status].label}</Badge>
                <p className="mt-1 text-sm font-semibold">{formatCurrency(r.earned)}</p>
              </div>
            </div>
          )}
        />

        <Pagination page={currentPage} pageCount={pageCount} onPageChange={setPage} />
      </CardBody>
    </Card>
  );
}
