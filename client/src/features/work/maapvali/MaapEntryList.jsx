import { useState } from "react";
import { Boxes, Pencil, Trash2 } from "lucide-react";
import Pagination from "../../../components/common/Pagination";
import ResponsiveTable from "../../../components/common/ResponsiveTable";
import { Dropdown, EmptyState } from "../../../components/ui";
import { formatCurrency, formatNumber } from "../../../utils/formatCurrency";
import { formatDate } from "../../../utils/formatDate";
import { estimateBricks } from "../../../utils/workCalculations";

const iconButton = "rounded-lg p-2 text-fg-muted hover:bg-background hover:text-fg";

/**
 * Work history: Date, (Maapvali), Maaps, Rate, Earnings, Note (+ Edit / Delete).
 * Phones get one card per entry, md+ gets a table.
 */
export default function MaapEntryList({
  entries,
  showWorker = true,
  onEdit,
  onDelete,
  pageSize = 10,
  emptyTitle = "No work entries yet",
  emptyDescription = "Entries you add will show up here.",
  emptyAction,
}) {
  const [page, setPage] = useState(1);
  const showActions = Boolean(onEdit || onDelete);

  const pageCount = Math.max(1, Math.ceil(entries.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const rows = entries.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const columns = [
    { key: "date", header: "Date", render: (e) => formatDate(e.date) },
    ...(showWorker
      ? [
          {
            key: "worker",
            header: "Maapvali",
            render: (e) => (
              <div>
                <p className="font-medium">{e.workerName}</p>
                <p className="type-small">{e.labourId}</p>
              </div>
            ),
          },
        ]
      : []),
    {
      key: "maaps",
      header: "Maaps",
      align: "right",
      render: (e) => (
        <div>
          <p className="font-medium">{formatNumber(e.numberOfMaaps)}</p>
          <p className="type-small">about {formatNumber(estimateBricks(e.numberOfMaaps))} bricks</p>
        </div>
      ),
    },
    { key: "rate", header: "Rate / 4 maaps", align: "right", render: (e) => formatCurrency(e.ratePerFourMaaps) },
    { key: "earnings", header: "Earnings", align: "right", className: "font-semibold", render: (e) => formatCurrency(e.earnings) },
    { key: "note", header: "Note", className: "max-w-48 truncate text-fg-muted", render: (e) => e.note || "-" },
    ...(showActions
      ? [
          {
            key: "actions",
            header: "Actions",
            align: "right",
            render: (e) => (
              <div className="flex items-center justify-end gap-0.5">
                {onEdit && (
                  <button type="button" aria-label="Edit entry" className={iconButton} onClick={() => onEdit(e)}>
                    <Pencil className="h-4 w-4" />
                  </button>
                )}
                {onDelete && (
                  <button type="button" aria-label="Delete entry" className={`${iconButton} hover:text-danger`} onClick={() => onDelete(e)}>
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            ),
          },
        ]
      : []),
  ];

  return (
    <div className="space-y-4">
      <ResponsiveTable
        columns={columns}
        data={rows}
        empty={<EmptyState icon={Boxes} title={emptyTitle} description={emptyDescription} action={emptyAction} />}
        renderCard={(e) => (
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              {showWorker && <p className="truncate font-medium">{e.workerName}</p>}
              <p className="type-small">
                {showWorker ? `${e.labourId} - ` : ""}
                {formatDate(e.date)}
              </p>
              <p className="mt-1.5 text-sm font-semibold">{formatNumber(e.numberOfMaaps)} maaps</p>
              <p className="type-small">
                {formatNumber(e.numberOfMaaps)} / 4 x {formatCurrency(e.ratePerFourMaaps)} per 4 maaps
              </p>
              {e.note && <p className="type-small mt-1 line-clamp-2">{e.note}</p>}
            </div>
            <p className="shrink-0 pt-0.5 text-base font-bold">{formatCurrency(e.earnings)}</p>
            {showActions && (
              <Dropdown
                ariaLabel="Entry actions"
                triggerClassName="-mr-2 h-10 w-10"
                items={[
                  ...(onEdit ? [{ label: "Edit", icon: Pencil, onClick: () => onEdit(e) }] : []),
                  ...(onDelete ? [{ label: "Delete", icon: Trash2, variant: "danger", onClick: () => onDelete(e) }] : []),
                ]}
              />
            )}
          </div>
        )}
      />
      <Pagination page={currentPage} pageCount={pageCount} onPageChange={setPage} />
    </div>
  );
}
