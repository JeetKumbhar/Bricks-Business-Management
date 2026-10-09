import { UserRound } from "lucide-react";
import { Badge, Card, CardBody, CardHeader } from "../../../components/ui";
import { formatCurrency } from "../../../utils/formatCurrency";
import { formatDate } from "../../../utils/formatDate";
import { LABOUR_STATUS_META } from "../../../utils/labourStatus";

/** Name, Labour ID, Mobile, Joining Date, Daily Rate, Status (+ village). */
export default function LabourDetailsCard({ labour, className }) {
  const status = LABOUR_STATUS_META[labour.status];

  const rows = [
    { label: "Name", value: labour.name },
    { label: "Labour ID", value: labour.id },
    {
      label: "Mobile",
      value: (
        <a href={`tel:${labour.mobile}`} className="text-primary">
          {labour.mobile}
        </a>
      ),
    },
    { label: "Village", value: labour.village },
    { label: "Joining Date", value: formatDate(labour.joiningDate) },
    { label: "Daily Rate", value: `${formatCurrency(labour.dailyRate)} / day` },
    { label: "Status", value: <Badge variant={status.variant}>{status.label}</Badge> },
  ];

  return (
    <Card className={className}>
      <CardHeader title="Personal Details" icon={UserRound} />
      <CardBody>
        <dl className="divide-y divide-border text-sm">
          {rows.map((row) => (
            <div key={row.label} className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
              <dt className="text-fg-muted">{row.label}</dt>
              <dd className="text-right font-medium">{row.value}</dd>
            </div>
          ))}
        </dl>
      </CardBody>
    </Card>
  );
}
