import { Badge } from "../../components/ui";
import { LABOUR_TYPE_META } from "../../utils/labourTypes";

/** "Bigari", "Maapvali" or "Patlavale (Team)" */
export default function LabourTypeBadge({ type, size = "sm" }) {
  const meta = LABOUR_TYPE_META[type];
  return (
    <Badge variant={meta.badgeVariant} size={size}>
      {meta.label}
      {meta.noun === "team" ? " (Team)" : ""}
    </Badge>
  );
}
