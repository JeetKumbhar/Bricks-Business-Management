import { History, Pencil, Receipt, Trash2 } from "lucide-react";
import Pagination from "../../components/common/Pagination";
import ResponsiveTable from "../../components/common/ResponsiveTable";
import { Badge, Button, Card, CardBody, CardHeader, Dropdown, EmptyState } from "../../components/ui";
import { formatCurrency } from "../../utils/formatCurrency";
import { formatDate } from "../../utils/formatDate";
import { PAYMENT_TYPE_META } from "../../utils/paymentTypes";
import LabourTypeBadge from "../labours/LabourTypeBadge";

const PAGE_SIZE = 10;
const iconButton = "rounded-lg p-2 text-fg-muted hover:bg-background hover:text-fg";

/**
 * Columns: Date, Recipient (+ labour type), Type, Amount, Note, Actions.
 * Phones get cards, md+ gets a table. A corrected payment shows "Corrected" and "View changes" keeps its history.
 */
export default function PaymentHistory({ payments, page, onPageChange, onEdit, onDelete, onViewChanges, hasFilters, onClearFilters }) {
  const total = payments.length;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const currentPage = Math.min(Math.max(page, 1), pageCount);
  const start = (currentPage - 1) * PAGE_SIZE;
  const rows = payments.slice(start, start + PAGE_SIZE);
  const showing = total === 0 ? "No results" : `Showing ${start + 1}-${start + rows.length} of ${total}`;

  const corrected = (p) => (p.revisions?.length ?? 0) > 0;

  const columns = [
    { key: "date", header: "Date", render: (p) => formatDate(p.date) },
    {
      key: "labour",
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
    {
      key: "type",
      header: "Type",
      render: (p) => (
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant={PAYMENT_TYPE_META[p.type].variant}>{PAYMENT_TYPE_META[p.type].label}</Badge>
          {corrected(p) && (
            <Badge variant="neutral" size="sm">
              Corrected
            </Badge>
          )}
        </div>
      ),
    },
    { key: "amount", header: "Amount", align: "right", className: "font-semibold", render: (p) => formatCurrency(p.amount) },
    { key: "note", header: "Note", className: "max-w-56 truncate text-fg-muted", render: (p) => p.note || "-" },
    {
      key: "actions",
      header: "Actions",
      align: "right",
      render: (p) => (
        <div className="flex items-center justify-end gap-0.5">
          {corrected(p) && (
            <button type="button" aria-label={`View changes to payment of ${p.labourName}`} className={iconButton} onClick={() => onViewChanges(p)}>
              <History className="h-4 w-4" />
            </button>
          )}
          <button type="button" aria-label={`Edit payment of ${p.labourName}`} className={iconButton} onClick={() => onEdit(p)}>
            <Pencil className="h-4 w-4" />
          </button>
          <button
            type="button"
            aria-label={`Delete payment of ${p.labourName}`}
            className={`${iconButton} hover:text-danger`}
            onClick={() => onDelete(p)}
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      ),
    },
  ];

  return (
    <Card>
      <CardHeader title="Payment History" icon={Receipt} action={<span className="type-small">{showing}</span>} />
      <CardBody className="space-y-4">
        <ResponsiveTable
          columns={columns}
          data={rows}
          empty={
            <EmptyState
              icon={Receipt}
              title="No payments found"
              description={hasFilters ? "Try a different search or filter." : "Payments you record will show up here."}
              action={
                hasFilters ? (
                  <Button variant="outline" onClick={onClearFilters}>
                    Clear filters
                  </Button>
                ) : undefined
              }
            />
          }
          renderCard={(p) => (
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{p.labourName}</p>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 type-small">
                  {p.labourId} - {formatDate(p.date)}
                  {p.labourType && <LabourTypeBadge type={p.labourType} />}
                </p>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  <Badge variant={PAYMENT_TYPE_META[p.type].variant} size="sm">
                    {PAYMENT_TYPE_META[p.type].label}
                  </Badge>
                  {corrected(p) && (
                    <Badge variant="neutral" size="sm">
                      Corrected
                    </Badge>
                  )}
                </div>
                {p.note && <p className="type-small mt-1.5 line-clamp-2">{p.note}</p>}
              </div>
              <p className="shrink-0 pt-0.5 text-base font-bold">{formatCurrency(p.amount)}</p>
              <Dropdown
                ariaLabel={`Actions for payment of ${p.labourName}`}
                triggerClassName="-mr-2 h-10 w-10"
                items={[
                  { label: "Edit", icon: Pencil, onClick: () => onEdit(p) },
                  ...(corrected(p) ? [{ label: "View changes", icon: History, onClick: () => onViewChanges(p) }] : []),
                  { label: "Delete", icon: Trash2, variant: "danger", onClick: () => onDelete(p) },
                ]}
              />
            </div>
          )}
        />
        <Pagination page={currentPage} pageCount={pageCount} onPageChange={onPageChange} />
      </CardBody>
    </Card>
  );
}
