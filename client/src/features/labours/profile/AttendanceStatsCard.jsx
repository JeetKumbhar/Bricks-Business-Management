import { CalendarCheck } from "lucide-react";
import { Card, CardBody, CardHeader } from "../../../components/ui";

const tiles = [
  { key: "presentDays", label: "Present Days", style: "bg-green-50 text-green-700" },
  { key: "halfDays", label: "Half Days", style: "bg-amber-50 text-amber-700" },
  { key: "absentDays", label: "Absent Days", style: "bg-red-50 text-red-600" },
  { key: "workingUnits", label: "Working Units", style: "bg-blue-50 text-blue-700" },
];

/** Present / Half / Absent counts and Working Units (= present + half x 0.5). */
export default function AttendanceStatsCard({ labour, className }) {
  return (
    <Card className={className}>
      <CardHeader title="Attendance" subtitle="All recorded days" icon={CalendarCheck} />
      <CardBody>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {tiles.map((tile) => (
            <div key={tile.key} className={`rounded-lg p-3 ${tile.style}`}>
              <p className="text-xs font-medium opacity-80">{tile.label}</p>
              <p className="mt-1 text-2xl font-bold leading-none">{labour[tile.key]}</p>
            </div>
          ))}
        </div>
        <p className="type-small mt-3">Working units = present days + half days x 0.5</p>
      </CardBody>
    </Card>
  );
}
