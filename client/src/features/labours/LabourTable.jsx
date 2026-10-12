import { Eye, Pencil, UserCheck, Users, UserX } from "lucide-react";
import Pagination from "../../components/common/Pagination";
import { Badge, Button, Card, CardBody, CardHeader, Dropdown, EmptyState, Table } from "../../components/ui";
import { calculateBalance } from "../../utils/calculations";
import { cn } from "../../utils/cn";
import { formatCurrency } from "../../utils/formatCurrency";
import { formatRate } from "../../utils/formatRate";
import { LABOUR_STATUS, LABOUR_STATUS_META } from "../../utils/labourStatus";
import LabourAvatar from "./LabourAvatar";
import LabourCard from "./LabourCard";
import { getWorkSummary } from "./labourSummaries";
import LabourTypeBadge from "./LabourTypeBadge";

const PAGE_SIZE = 10;

const iconButton = "rounded-lg p-2 text-fg-muted hover:bg-background hover:text-fg";

/**
 * labours: the already-filtered list (all three types). This component paginates it.
 * Columns: Labour ID, Name (+ type), Mobile, Rate (+ unit), Status, Work, Balance, Actions
 * Phones get one card per worker / team, md+ gets a table.
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
          <LabourAvatar worker={l} />
          <div>
            <p className="font-medium">{l.name}</p>
            <p className="type-small">{l.village}</p>
          </div>
        </div>
      ),
    },
    { key: "type", header: "Type", render: (l) => <LabourTypeBadge type={l.labourType} /> },
    { key: "mobile", header: "Mobile" },
    { key: "rate", header: "Rate", render: (l) => formatRate(l) },
    {
      key: "status",
      header: "Status",
      render: (l) => {
        const meta = LABOUR_STATUS_META[l.status];
        return <Badge variant={meta.variant}>{meta.label}</Badge>;
      },
    },
    {
      key: "work",
      header: "Work",
      render: (l) => {
        const work = getWorkSummary(l);
        return (
          <div>
            <p className="font-medium">{work.primary}</p>
            <p className="type-small">{work.secondary}</p>
          </div>
        );
      },
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
            {/* Phones: one card per worker / team */}
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
