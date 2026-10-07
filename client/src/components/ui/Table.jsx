import { cn } from "../../utils/cn";
import EmptyState from "./EmptyState";
import { Skeleton } from "./LoadingState";

const alignClass = { left: "text-left", center: "text-center", right: "text-right" };

/**
 * columns: [{ key, header, render?(row, index), align?, width?, className?, headerClassName? }]
 *
 * <Table
 *   columns={columns}
 *   data={labours}
 *   rowKey="id"
 *   loading={isLoading}
 *   onRowClick={(row) => navigate(`/labour/${row.id}`)}
 *   selectable selectedKeys={sel} onSelectionChange={setSel}
 * />
 *
 * Scrolls horizontally on small screens. Pagination is a separate concern (added with the Labour feature).
 */
export default function Table({
  columns,
  data = [],
  rowKey = "id",
  onRowClick,
  loading = false,
  skeletonRows = 5,
  empty,
  selectable = false,
  selectedKeys = [],
  onSelectionChange,
  className,
}) {
  const getKey = (row, i) => (typeof rowKey === "function" ? rowKey(row, i) : row[rowKey]);
  const allKeys = data.map(getKey);
  const allSelected = allKeys.length > 0 && allKeys.every((k) => selectedKeys.includes(k));
  const colCount = columns.length + (selectable ? 1 : 0);

  const toggleAll = () => onSelectionChange?.(allSelected ? [] : allKeys);
  const toggleOne = (key) =>
    onSelectionChange?.(selectedKeys.includes(key) ? selectedKeys.filter((k) => k !== key) : [...selectedKeys, key]);

  return (
    <div className={cn("overflow-x-auto rounded-xl border border-border bg-surface", className)}>
      <table className="type-table w-full min-w-max border-collapse">
        <thead className="bg-background">
          <tr>
            {selectable && (
              <th scope="col" className="w-10 px-4 py-3">
                <input
                  type="checkbox"
                  aria-label="Select all rows"
                  checked={allSelected}
                  onChange={toggleAll}
                  className="h-4 w-4 rounded border-border accent-primary"
                />
              </th>
            )}
            {columns.map((col) => (
              <th
                key={col.key}
                scope="col"
                style={col.width ? { width: col.width } : undefined}
                className={cn(
                  "whitespace-nowrap px-4 py-3 text-xs font-semibold text-fg-muted",
                  alignClass[col.align ?? "left"],
                  col.headerClassName
                )}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          {loading ? (
            Array.from({ length: skeletonRows }).map((_, r) => (
              <tr key={`skeleton-${r}`} className="border-t border-border">
                {Array.from({ length: colCount }).map((__, c) => (
                  <td key={c} className="px-4 py-3.5">
                    <Skeleton className="h-4 w-full max-w-32" />
                  </td>
                ))}
              </tr>
            ))
          ) : data.length === 0 ? (
            <tr className="border-t border-border">
              <td colSpan={colCount}>{empty ?? <EmptyState title="No records found" />}</td>
            </tr>
          ) : (
            data.map((row, index) => {
              const key = getKey(row, index);
              const selected = selectedKeys.includes(key);
              return (
                <tr
                  key={key}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  onKeyDown={
                    onRowClick
                      ? (e) => {
                          if (e.key === "Enter") onRowClick(row);
                        }
                      : undefined
                  }
                  tabIndex={onRowClick ? 0 : undefined}
                  className={cn(
                    "border-t border-border transition-colors hover:bg-background/70",
                    onRowClick && "cursor-pointer",
                    selected && "bg-primary-soft/60"
                  )}
                >
                  {selectable && (
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        aria-label="Select row"
                        checked={selected}
                        onChange={() => toggleOne(key)}
                        className="h-4 w-4 rounded border-border accent-primary"
                      />
                    </td>
                  )}
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      className={cn("whitespace-nowrap px-4 py-3", alignClass[col.align ?? "left"], col.className)}
                    >
                      {col.render ? col.render(row, index) : row[col.key]}
                    </td>
                  ))}
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
