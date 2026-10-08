import { Receipt } from "lucide-react";
import { Badge, Card, CardBody, CardHeader, Table } from "../../components/ui";
import { formatCurrency } from "../../utils/formatCurrency";
import { formatDate } from "../../utils/formatDate";
import { PAYMENT_TYPE_META } from "../../utils/paymentTypes";
import ViewAllButton from "./ViewAllButton";

const columns = [
  { key: "date", header: "Date", render: (p) => formatDate(p.date) },
  {
    key: "labour",
    header: "Labour",
    render: (p) => (
      <div>
        <p className="font-medium">{p.labourName}</p>
        <p className="type-small">{p.labourId}</p>
      </div>
    ),
  },
  {
    key: "type",
    header: "Type",
    render: (p) => {
      const meta = PAYMENT_TYPE_META[p.type];
      return <Badge variant={meta.variant}>{meta.label}</Badge>;
    },
  },
  { key: "amount", header: "Amount", align: "right", className: "font-semibold", render: (p) => formatCurrency(p.amount) },
];

/** Phones: simple list rows. md and up: table. */
export default function RecentPayments({ payments, className }) {
  return (
    <Card className={className}>
      <CardHeader title="Recent Payments" icon={Receipt} action={<ViewAllButton to="/payments" />} />
      <CardBody>
        <ul className="divide-y divide-border md:hidden">
          {payments.map((p) => {
            const meta = PAYMENT_TYPE_META[p.type];
            return (
              <li key={p.id} className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{p.labourName}</p>
                  <p className="type-small">
                    {formatDate(p.date)} - {p.labourId}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-sm font-semibold">{formatCurrency(p.amount)}</p>
                  <Badge variant={meta.variant} size="sm" className="mt-1">
                    {meta.label}
                  </Badge>
                </div>
              </li>
            );
          })}
        </ul>

        <div className="hidden md:block">
          <Table columns={columns} data={payments} rowKey="id" />
        </div>
      </CardBody>
    </Card>
  );
}
