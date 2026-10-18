import { useMemo, useState } from "react";
import { Receipt } from "lucide-react";
import { Badge, Tabs } from "../../components/ui";
import { downloadCsv } from "../../utils/exportCsv";
import { formatCurrency } from "../../utils/formatCurrency";
import { formatDate } from "../../utils/formatDate";
import { LABOUR_TYPE_META } from "../../utils/labourTypes";
import { PAYMENT_TYPE_META, PAYMENT_TYPES } from "../../utils/paymentTypes";
import LabourTypeBadge from "../labours/LabourTypeBadge";
import usePayments from "../payments/usePayments";
import ReportSection from "./ReportSection";

/** Bayana and payment history for every recipient in the range (deleted payments are not included). */
export default function PaymentsReport({ period }) {
  const { history } = usePayments();
  const [type, setType] = useState("ALL");

  const inRange = useMemo(() => history.filter((p) => p.date >= period.start && p.date <= period.end), [history, period.start, period.end]);
  const data = type === "ALL" ? inRange : inRange.filter((p) => p.type === type);
  const totalOf = (list, t) => list.filter((p) => !t || p.type === t).reduce((sum, p) => sum + p.amount, 0);

  const tabs = [
    { id: "ALL", label: "All", count: inRange.length },
    { id: PAYMENT_TYPES.BOOKING_ADVANCE, label: "Bayana", count: inRange.filter((p) => p.type === PAYMENT_TYPES.BOOKING_ADVANCE).length },
    { id: PAYMENT_TYPES.SALARY_PAYMENT, label: "Salary", count: inRange.filter((p) => p.type === PAYMENT_TYPES.SALARY_PAYMENT).length },
    { id: PAYMENT_TYPES.OTHER, label: "Other", count: inRange.filter((p) => p.type === PAYMENT_TYPES.OTHER).length },
  ];

  const columns = [
    { key: "date", header: "Date", render: (p) => formatDate(p.date) },
    {
      key: "who",
      header: "Recipient",
      render: (p) => (
        <div>
          <p className="font-medium">{p.labourName}</p>
          <p className="mt-0.5 flex items-center gap-2 type-small">
            {p.labourId}
            {p.labourType && <LabourTypeBadge type={p.labourType} />}
          </p>
        </div>
      ),
    },
    { key: "type", header: "Type", render: (p) => <Badge variant={PAYMENT_TYPE_META[p.type].variant}>{PAYMENT_TYPE_META[p.type].label}</Badge> },
    { key: "amount", header: "Amount", align: "right", className: "font-semibold", render: (p) => formatCurrency(p.amount) },
    { key: "note", header: "Note", className: "max-w-56 truncate text-fg-muted", render: (p) => p.note || "-" },
  ];

  const exportCsv = () =>
    downloadCsv(
      `payments-report_${period.isSeason ? "season" : `${period.start}_to_${period.end}`}.csv`,
      ["Date", "ID", "Recipient", "Labour type", "Payment type", "Amount", "Note"],
      data.map((p) => [p.date, p.labourId, p.labourName, LABOUR_TYPE_META[p.labourType]?.label ?? "", PAYMENT_TYPE_META[p.type].label, p.amount, p.note])
    );

  return (
    <div className="space-y-4">
      <Tabs variant="pills" fullWidth tabs={tabs} value={type} onChange={setType} />
      <ReportSection
        key={`${period.start}|${period.end}|${type}`}
        title="Bayana and Payment History"
        subtitle={period.label}
        icon={Receipt}
        tiles={[
          { label: "Payments", value: data.length },
          { label: "Bayana", value: formatCurrency(totalOf(data, PAYMENT_TYPES.BOOKING_ADVANCE)) },
          { label: "Salary payments", value: formatCurrency(totalOf(data, PAYMENT_TYPES.SALARY_PAYMENT)) },
          { label: "Total paid", value: formatCurrency(totalOf(data)) },
        ]}
        columns={columns}
        data={data}
        onExport={exportCsv}
        renderCard={(p) => (
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate font-medium">{p.labourName}</p>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 type-small">
                {p.labourId} - {formatDate(p.date)}
                {p.labourType && <LabourTypeBadge type={p.labourType} />}
              </p>
              <Badge variant={PAYMENT_TYPE_META[p.type].variant} size="sm" className="mt-1.5">
                {PAYMENT_TYPE_META[p.type].label}
              </Badge>
              {p.note && <p className="type-small mt-1.5 line-clamp-2">{p.note}</p>}
            </div>
            <p className="shrink-0 text-base font-bold">{formatCurrency(p.amount)}</p>
          </div>
        )}
      />
    </div>
  );
}
