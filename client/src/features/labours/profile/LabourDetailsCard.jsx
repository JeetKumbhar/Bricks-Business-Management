import { UserRound, Users } from "lucide-react";
import { Badge, Card, CardBody, CardHeader } from "../../../components/ui";
import { formatDate } from "../../../utils/formatDate";
import { formatRate } from "../../../utils/formatRate";
import { LABOUR_STATUS_META } from "../../../utils/labourStatus";
import { LABOUR_TYPE_META, LABOUR_TYPES } from "../../../utils/labourTypes";
import LabourTypeBadge from "../LabourTypeBadge";

/**
 * Details for any type. The rate row follows the type: Daily Rate, Rate per Maap, or Rate per 1,000 Payable Bricks.
 * A Patlavale team is one salary account; its family members are reference only.
 */
export default function LabourDetailsCard({ labour, className }) {
  const status = LABOUR_STATUS_META[labour.status];
  const meta = LABOUR_TYPE_META[labour.labourType];
  const isTeam = labour.labourType === LABOUR_TYPES.PATLAVALE;

  const rows = [
    { label: meta.nameLabel, value: labour.name },
    { label: "Labour ID", value: labour.id },
    { label: "Labour Type", value: <LabourTypeBadge type={labour.labourType} /> },
    {
      label: meta.mobileLabel,
      value: (
        <a href={`tel:${labour.mobile}`} className="text-primary">
          {labour.mobile}
        </a>
      ),
    },
    { label: "Village", value: labour.village },
    { label: "Joining Date", value: formatDate(labour.joiningDate) },
    { label: meta.rateLabel, value: formatRate(labour) },
    { label: "Status", value: <Badge variant={status.variant}>{status.label}</Badge> },
  ];

  return (
    <Card className={className}>
      <CardHeader title={isTeam ? "Team Details" : "Personal Details"} icon={isTeam ? Users : UserRound} />
      <CardBody>
        <dl className="divide-y divide-border text-sm">
          {rows.map((row) => (
            <div key={row.label} className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
              <dt className="text-fg-muted">{row.label}</dt>
              <dd className="text-right font-medium">{row.value}</dd>
            </div>
          ))}
        </dl>

        {isTeam && (
          <div className="mt-4 border-t border-border pt-3">
            <p className="type-small">One salary account for the whole family. Members are for reference and are not paid separately.</p>
            {labour.members?.length > 0 && (
              <ul className="mt-2 divide-y divide-border text-sm">
                {labour.members.map((m) => (
                  <li key={m.name} className="flex items-center justify-between py-2">
                    <span className="font-medium">{m.name}</span>
                    <span className="text-fg-muted">{m.relation}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </CardBody>
    </Card>
  );
}
