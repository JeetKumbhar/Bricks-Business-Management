import { Eye, Pencil, UserCheck, Users, UserX } from "lucide-react";
import Pagination from "../../components/common/Pagination";
import { Badge, Button, Card, CardBody, CardHeader, Dropdown, EmptyState, Table } from "../../components/ui";
import { attendanceDays, calculateBalance } from "../../utils/calculations";
import { cn } from "../../utils/cn";
import { formatCurrency } from "../../utils/formatCurrency";
import { LABOUR_STATUS, LABOUR_STATUS_META } from "../../utils/labourStatus";
import LabourCard from "./LabourCard";

const PAGE_SIZE = 10;

const initials = (name) =>
  name
    .split(" ")
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

const iconButton = "rounded-lg p-2 text-fg-muted hover:bg-background hover:text-fg";

/**
 * labours: the already-filtered list. This component paginates it.
 * Columns: Labour ID, Name, Mobile, Daily Rate, Status, Present Days, Balance, Actions
 */
export default function LabourTable({
  labours,
  page,
  onPageChange,
  onView,
  onEdit,
  onToggleStatus,
  hasFilters,
  onClearFilters,
}) {
  const total = labours.length;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const currentPage = Math.min(Math.max(page, 1), pageCount);
  const startIndex = (currentPage - 1) * PAGE_SIZE;
  const rows = labours.slice(startIndex, startIndex + PAGE_SIZE);
  const showing = total === 0 ? "No results" : `Showing ${startIndex + 1}-${startIndex + rows.length} of ${total}`;

  const columns = [
    { key: "id", header: "Labour ID", className: "font-medium text-fg-muted" },
    {
      key: "name",
      header: "Name",
      render: (l) => (
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary-soft text-xs font-semibold text-primary">
            {initials(l.name)}
          </span>
          <div>
            <p className="font-medium">{l.name}</p>
            <p className="type-small">{l.village}</p>
          </div>
        </div>
      ),
    },
    { key: "mobile", header: "Mobile" },
    { key: "dailyRate", header: "Daily Rate", render: (l) => formatCurrency(l.dailyRate) },
    {
      key: "status",
      header: "Status",
      render: (l) => {
        const meta = LABOUR_STATUS_META[l.status];
        return <Badge variant={meta.variant}>{meta.label}</Badge>;
      },
    },
    {
      key: "presentDays",
      header: "Present Days",
      render: (l) => (
        <div>
          <p className="font-medium">{attendanceDays(l)}</p>
          <p className="type-small">
            {l.presentDays} full, {l.halfDays} half
          </p>
        </div>
      ),
    },
    {
      key: "balance",
      header: "Balance",
      align: "right",
      render: (l) => {
        const balance = calculateBalance(l);
        return (
          <span
            className={cn("font-semibold", balance < 0 && "text-danger")}
            title={balance < 0 ? "Overpaid" : undefined}
          >
            {formatCurrency(balance)}
          </span>
        );
      },
    },
    {
      key: "actions",
      header: "Actions",
      align: "right",
      render: (l) => {
        const isActive = l.status === LABOUR_STATUS.ACTIVE;
        return (
          <div className="flex items-center justify-end gap-0.5">
            <button
              type="button"
              aria-label={`View ${l.name}`}
              className={iconButton}
              onClick={(e) => {
                e.stopPropagation();
                onView(l);
              }}
            >
              <Eye className="h-4 w-4" />
            </button>
            <button
              type="button"
              aria-label={`Edit ${l.name}`}
              className={iconButton}
              onClick={(e) => {
                e.stopPropagation();
                onEdit(l);
              }}
            >
              <Pencil className="h-4 w-4" />
            </button>
            <Dropdown
              ariaLabel={`More actions for ${l.name}`}
              items={[
                {
                  label: isActive ? "Mark as inactive" : "Mark as active",
                  icon: isActive ? UserX : UserCheck,
                  variant: isActive ? "danger" : undefined,
                  onClick: () => onToggleStatus(l),
                },
              ]}
            />
          </div>
        );
      },
    },
  ];

  return (
    <Card>
      <CardHeader title="Labour List" icon={Users} action={<span className="type-small">{showing}</span>} />
      <CardBody className="space-y-4">
        {rows.length === 0 ? (
          <EmptyState
            icon={Users}
            title="No labour found"
            description="Try a different search or filter."
            action={
              hasFilters ? (
                <Button variant="outline" onClick={onClearFilters}>
                  Clear filters
                </Button>
              ) : undefined
            }
          />
        ) : (
          <>
            {/* Phones: one card per labour */}
            <ul className="space-y-3 md:hidden">
              {rows.map((l) => (
                <LabourCard key={l.id} labour={l} onView={onView} onEdit={onEdit} onToggleStatus={onToggleStatus} />
              ))}
            </ul>
            {/* Tablets / desktop: full table */}
            <div className="hidden md:block">
              <Table columns={columns} data={rows} rowKey="id" onRowClick={onView} />
            </div>
          </>
        )}
        <Pagination page={currentPage} pageCount={pageCount} onPageChange={onPageChange} />
      </CardBody>
    </Card>
  );
}
