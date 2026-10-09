import { EmptyState, Table } from "../ui";

/**
 * Phones: a simple list (renderCard draws each row).
 * md and up: a normal table.
 *
 * <ResponsiveTable columns={columns} data={rows} renderCard={(row) => <.../>} />
 */
export default function ResponsiveTable({ columns, data, rowKey = "id", renderCard, empty }) {
  if (data.length === 0) return empty ?? <EmptyState title="No records found" />;

  const keyOf = (row, i) => (typeof rowKey === "function" ? rowKey(row, i) : row[rowKey]);

  return (
    <>
      <ul className="divide-y divide-border md:hidden">
        {data.map((row, i) => (
          <li key={keyOf(row, i)} className="py-3 first:pt-0 last:pb-0">
            {renderCard(row)}
          </li>
        ))}
      </ul>
      <div className="hidden md:block">
        <Table columns={columns} data={data} rowKey={rowKey} />
      </div>
    </>
  );
}
