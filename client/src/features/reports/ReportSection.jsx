import { useState } from "react";
import { Download } from "lucide-react";
import Pagination from "../../components/common/Pagination";
import ResponsiveTable from "../../components/common/ResponsiveTable";
import { Button, Card, CardBody, CardHeader, EmptyState } from "../../components/ui";

const PAGE_SIZE = 15;

/**
 * Shared layout of every report: totals, the data (cards on phones, table on larger screens), and Export to CSV.
 * tiles: [{ label, value }]   columns / renderCard: see ResponsiveTable
 */
export default function ReportSection({ title, subtitle, icon, tiles, columns, data, renderCard, onExport, emptyTitle, note }) {
  const [page, setPage] = useState(1);
  const pageCount = Math.max(1, Math.ceil(data.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const rows = data.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  return (
    <Card>
      <CardHeader
        title={title}
        subtitle={subtitle}
        icon={icon}
        action={
          <Button variant="outline" size="sm" leftIcon={Download} onClick={onExport} disabled={data.length === 0}>
            Export
          </Button>
        }
      />
      <CardBody className="space-y-4">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
          {tiles.map((t) => (
            <div key={t.label} className="rounded-lg bg-background p-3">
              <p className="text-xs text-fg-muted">{t.label}</p>
              <p className="mt-0.5 truncate text-base font-bold sm:text-lg">{t.value}</p>
            </div>
          ))}
        </div>

        <ResponsiveTable
          columns={columns}
          data={rows}
          renderCard={renderCard}
          empty={<EmptyState title={emptyTitle ?? "Nothing to report for this range"} description="Try a wider date range." />}
        />
        <Pagination page={currentPage} pageCount={pageCount} onPageChange={setPage} />
        {note && <p className="type-small">{note}</p>}
      </CardBody>
    </Card>
  );
}
