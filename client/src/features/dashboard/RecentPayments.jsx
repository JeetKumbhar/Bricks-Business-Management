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

export default function RecentPayments({ payments, className }) {
  return (
    <Card className={className}>
      <CardHeader title="Recent Payments" icon={Receipt} action={<ViewAllButton to="/payments" />} />
      <CardBody>
        <Table columns={columns} data={payments} rowKey="id" />
      </CardBody>
    </Card>
  );
}
