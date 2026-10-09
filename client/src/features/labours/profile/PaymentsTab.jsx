import { useMemo, useState } from "react";
import { Receipt } from "lucide-react";
import Pagination from "../../../components/common/Pagination";
import ResponsiveTable from "../../../components/common/ResponsiveTable";
import { Badge, Card, CardBody, CardHeader, Tabs } from "../../../components/ui";
import { formatCurrency } from "../../../utils/formatCurrency";
import { formatDate } from "../../../utils/formatDate";
import { PAYMENT_TYPE_META } from "../../../utils/paymentTypes";

const PAGE_SIZE = 10;

const methodLabel = { CASH: "Cash", UPI: "UPI", BANK: "Bank" };

const columns = [
  { key: "date", header: "Date", render: (p) => formatDate(p.date) },
  {
    key: "type",
    header: "Type",
    render: (p) => <Badge variant={PAYMENT_TYPE_META[p.type].variant}>{PAYMENT_TYPE_META[p.type].label}</Badge>,
  },
  { key: "method", header: "Method", render: (p) => methodLabel[p.method] ?? p.method },
  { key: "note", header: "Note", render: (p) => p.note || "-" },
  { key: "amount", header: "Amount", align: "right", className: "font-semibold", render: (p) => formatCurrency(p.amount) },
];

function StatTile({ label, value }) {
  return (
    <div className="rounded-lg border border-border p-3">
      <p className="text-xs text-fg-muted">{label}</p>
      <p className="mt-1 text-base font-bold sm:text-lg">{value}</p>
    </div>
  );
}

/** Every payment given to this labour, newest first. (Recording payments comes with the Payments phase.) */
export default function PaymentsTab({ labour, payments }) {
  const [filter, setFilter] = useState("ALL");
  const [page, setPage] = useState(1);

  const counts = useMemo(
    () => ({
      ALL: payments.length,
      BOOKING_ADVANCE: payments.filter((p) => p.type === "BOOKING_ADVANCE").length,
      SALARY_PAYMENT: payments.filter((p) => p.type === "SALARY_PAYMENT").length,
      OTHER: payments.filter((p) => p.type === "OTHER").length,
    }),
    [payments]
  );

  const filtered = filter === "ALL" ? payments : payments.filter((p) => p.type === filter);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const rows = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const tabs = [
    { id: "ALL", label: "All", count: counts.ALL },
    { id: "BOOKING_ADVANCE", label: "Advance", count: counts.BOOKING_ADVANCE },
    { id: "SALARY_PAYMENT", label: "Salary", count: counts.SALARY_PAYMENT },
    { id: "OTHER", label: "Other", count: counts.OTHER },
  ];

  return (
    <Card>
      <CardHeader title="Payments" subtitle={`${filtered.length} records`} icon={Receipt} />
      <CardBody className="space-y-4">
        <div className="grid grid-cols-3 gap-2 sm:gap-3">
          <StatTile label="Booking Advance" value={formatCurrency(labour.bookingAdvance)} />
          <StatTile label="Salary Payments" value={formatCurrency(labour.salaryPayments)} />
          <StatTile label="Total Received" value={formatCurrency(labour.totalReceived)} />
        </div>

        <Tabs
          variant="pills"
          tabs={tabs}
          value={filter}
          onChange={(id) => {
            setFilter(id);
            setPage(1);
          }}
        />

        <ResponsiveTable
          columns={columns}
          data={rows}
          renderCard={(p) => (
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <Badge variant={PAYMENT_TYPE_META[p.type].variant} size="sm">
                  {PAYMENT_TYPE_META[p.type].label}
                </Badge>
                <p className="type-small mt-1">
                  {formatDate(p.date)} - {methodLabel[p.method] ?? p.method}
                </p>
                {p.note && <p className="type-small truncate">{p.note}</p>}
              </div>
              <p className="shrink-0 text-sm font-semibold">{formatCurrency(p.amount)}</p>
            </div>
          )}
        />

        <Pagination page={currentPage} pageCount={pageCount} onPageChange={setPage} />
      </CardBody>
    </Card>
  );
}
