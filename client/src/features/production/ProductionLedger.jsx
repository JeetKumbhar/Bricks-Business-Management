import { useState } from "react";
import { Factory, Pencil, Trash2 } from "lucide-react";
import Pagination from "../../components/common/Pagination";
import ResponsiveTable from "../../components/common/ResponsiveTable";
import { Dropdown, EmptyState } from "../../components/ui";
import { formatCurrency, formatNumber } from "../../utils/formatCurrency";
import { formatDate } from "../../utils/formatDate";

const iconButton = "rounded-lg p-2 text-fg-muted hover:bg-background hover:text-fg";

/**
 * The ledger: one row per production entry, newest first.
 * Date, Team, New physical, Previous carry, Available, Groups, Payable, Carry after, Rate, Earnings, Note.
 * Phones get one card per entry, md+ gets a table. Pass onEdit / onDelete to show the actions.
 */
export default function ProductionLedger({
  entries,
  showTeam = true,
  onEdit,
  onDelete,
  pageSize = 10,
  emptyTitle = "No production entries yet",
  emptyDescription = "Entries you add will show up here.",
  emptyAction,
}) {
  const [page, setPage] = useState(1);
  const showActions = Boolean(onEdit || onDelete);

  const pageCount = Math.max(1, Math.ceil(entries.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const rows = entries.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const number = (key, header, extra = {}) => ({
    key,
    header,
    align: "right",
    render: (e) => formatNumber(e[key]),
    ...extra,
  });

  const columns = [
    { key: "date", header: "Date", render: (e) => formatDate(e.date) },
    ...(showTeam
      ? [
          {
            key: "team",
            header: "Family / Team",
            render: (e) => (
              <div>
                <p className="font-medium">{e.teamName}</p>
                <p className="type-small">{e.teamId}</p>
              </div>
            ),
          },
        ]
      : []),
    number("newPhysicalBricks", "New physical"),
    number("previousCarryBricks", "Previous carry"),
    number("physicalAvailable", "Available"),
    number("completedGroups", "Groups of 1,100"),
    number("newPayableBricks", "Payable", { className: "font-semibold" }),
    number("carryForwardBricks", "Carry after"),
    { key: "rate", header: "Rate / 1,000", align: "right", render: (e) => formatCurrency(e.ratePer1000PayableBricks) },
    { key: "newEarnings", header: "Earnings", align: "right", className: "font-semibold", render: (e) => formatCurrency(e.newEarnings) },
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

  const Cell = ({ label, value, strong }) => (
    <div>
      <dt className="type-small">{label}</dt>
      <dd className={strong ? "font-semibold" : "font-medium"}>{value}</dd>
    </div>
  );

  return (
    <div className="space-y-4">
      <ResponsiveTable
        columns={columns}
        data={rows}
        empty={<EmptyState icon={Factory} title={emptyTitle} description={emptyDescription} action={emptyAction} />}
        renderCard={(e) => (
          <div className="space-y-3">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                {showTeam && <p className="truncate font-medium">{e.teamName}</p>}
                <p className="type-small">
                  {showTeam ? `${e.teamId} - ` : ""}
                  {formatDate(e.date)}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-base font-bold">{formatCurrency(e.newEarnings)}</p>
                <p className="type-small">{formatCurrency(e.ratePer1000PayableBricks)} / 1,000</p>
              </div>
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

            <dl className="grid grid-cols-3 gap-x-3 gap-y-2.5 rounded-lg bg-background p-3 text-sm">
              <Cell label="New physical" value={formatNumber(e.newPhysicalBricks)} />
              <Cell label="Previous carry" value={formatNumber(e.previousCarryBricks)} />
              <Cell label="Available" value={formatNumber(e.physicalAvailable)} />
              <Cell label="Groups of 1,100" value={formatNumber(e.completedGroups)} />
              <Cell label="Payable" value={formatNumber(e.newPayableBricks)} strong />
              <Cell label="Carry after" value={formatNumber(e.carryForwardBricks)} />
            </dl>
            {e.note && <p className="type-small line-clamp-2">{e.note}</p>}
          </div>
        )}
      />
      <Pagination page={currentPage} pageCount={pageCount} onPageChange={setPage} />
    </div>
  );
}
