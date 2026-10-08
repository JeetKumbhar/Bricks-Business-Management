import { CalendarDays } from "lucide-react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, CardBody, CardHeader } from "../../components/ui";
import { formatDate, formatShortWeekday } from "../../utils/formatDate";
import { chartColors } from "./chartColors";
import ViewAllButton from "./ViewAllButton";

const series = [
  { key: "present", label: "Present", color: chartColors.present },
  { key: "halfDay", label: "Half Day", color: chartColors.halfDay },
  { key: "absent", label: "Absent", color: chartColors.absent },
];

/** Last 7 days of attendance as a line chart. */
export default function AttendanceSummary({ data, className }) {
  const chartData = data.map((d) => ({ ...d, day: formatShortWeekday(d.date), fullDate: formatDate(d.date) }));

  return (
    <Card className={className}>
      <CardHeader
        title="Attendance Summary"
        subtitle="Last 7 days"
        icon={CalendarDays}
        action={<ViewAllButton to="/attendance" />}
      />
      <CardBody>
        <ul className="mb-3 flex flex-wrap gap-x-5 gap-y-1">
          {series.map((s) => (
            <li key={s.key} className="flex items-center gap-1.5 text-xs text-fg-muted">
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: s.color }} aria-hidden="true" />
              {s.label}
            </li>
          ))}
        </ul>

        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid stroke={chartColors.grid} strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="day" tick={{ fontSize: 12, fill: chartColors.axis }} tickLine={false} axisLine={false} />
              <YAxis
                allowDecimals={false}
                tick={{ fontSize: 12, fill: chartColors.axis }}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip
                labelFormatter={(_, payload) => payload?.[0]?.payload?.fullDate ?? ""}
                contentStyle={{ borderRadius: 8, borderColor: chartColors.grid, fontSize: 12 }}
              />
              {series.map((s) => (
                <Line
                  key={s.key}
                  type="monotone"
                  dataKey={s.key}
                  name={s.label}
                  stroke={s.color}
                  strokeWidth={2}
                  dot={{ r: 3 }}
                  activeDot={{ r: 5 }}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </CardBody>
    </Card>
  );
}
