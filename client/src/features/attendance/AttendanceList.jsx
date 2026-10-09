import { Users } from "lucide-react";
import { EmptyState } from "../../components/ui";
import AttendanceRow from "./AttendanceRow";

export default function AttendanceList({ labours, statusOf, onChange, emptyTitle, emptyDescription }) {
  if (labours.length === 0) {
    return <EmptyState icon={Users} title={emptyTitle} description={emptyDescription} />;
  }

  return (
    <ul className="space-y-2.5">
      {labours.map((labour) => (
        <AttendanceRow key={labour.id} labour={labour} status={statusOf(labour.id)} onChange={onChange} />
      ))}
    </ul>
  );
}
