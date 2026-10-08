import { Wallet } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, CardBody, CardHeader } from "../../components/ui";
import { sumBy } from "../../utils/calculations";
import { formatCurrency } from "../../utils/formatCurrency";
import { formatDate, formatShortWeekday } from "../../utils/formatDate";
import { chartColors } from "./chartColors";
import ViewAllButton from "./ViewAllButton";

const series = [
  { key: "bookingAdvance", label: "Booking Advance", color: chartColors.bookingAdvance },
  { key: "salaryPayment", label: "Salary Payment", color: chartColors.salaryPayment },
  { key: "other", label: "Other", color: chartColors.other },
];

const axisMoney = (v) => (v >= 1000 ? `${v / 1000}k` : v);

/** Last 7 days of payments, stacked by type, with totals per type. */
export default function PaymentSummary({ data, className }) {
  const chartData = data.map((d) => ({ ...d, day: formatShortWeekday(d.date), fullDate: formatDate(d.date) }));

  return (
    <Card className={className}>
      <CardHeader
        title="Payment Summary"
        subtitle="Last 7 days"
        icon={Wallet}
        action={<ViewAllButton to="/payments" />}
      />
      <CardBody>
        <div className="mb-4 grid grid-cols-3 gap-2 sm:gap-3">
          {series.map((s) => (
            <div key={s.key} className="rounded-lg border border-border p-2.5 sm:p-3">
              <p className="flex items-center gap-1.5 text-[11px] text-fg-muted sm:text-xs">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: s.color }} aria-hidden="true" />
                <span className="truncate">{s.label}</span>
              </p>
              <p className="mt-1 text-sm font-semibold sm:text-base">{formatCurrency(sumBy(data, s.key))}</p>
            </div>
          ))}
        </div>

        <div className="h-56 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
              <CartesianGrid stroke={chartColors.grid} strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="day" tick={{ fontSize: 12, fill: chartColors.axis }} tickLine={false} axisLine={false} />
              <YAxis tickFormatter={axisMoney} tick={{ fontSize: 12, fill: chartColors.axis }} tickLine={false} axisLine={false} />
              <Tooltip
                cursor={{ fill: "rgba(100,116,139,0.08)" }}
                labelFormatter={(_, payload) => payload?.[0]?.payload?.fullDate ?? ""}
                formatter={(value, name) => [formatCurrency(value), name]}
                contentStyle={{ borderRadius: 8, borderColor: chartColors.grid, fontSize: 12 }}
              />
              {series.map((s, i) => (
                <Bar
                  key={s.key}
                  dataKey={s.key}
                  name={s.label}
                  stackId="payments"
                  fill={s.color}
                  radius={i === series.length - 1 ? [4, 4, 0, 0] : 0}
                  maxBarSize={36}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardBody>
    </Card>
  );
}
