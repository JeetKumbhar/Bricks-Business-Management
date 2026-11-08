import { Badge } from "../../components/ui";
import { STATUS_META } from "./billModel";

export default function BillStatusBadge({ status }) {
  const meta = STATUS_META[status];
  return (
    <Badge variant={meta.variant} size="sm">
      {meta.label}
    </Badge>
  );
}
