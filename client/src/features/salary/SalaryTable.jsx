import { useMemo, useState } from "react";
import { Wallet } from "lucide-react";
import Pagination from "../../components/common/Pagination";
import ResponsiveTable from "../../components/common/ResponsiveTable";
import { Card, CardBody, CardHeader, EmptyState, SearchInput, Tabs } from "../../components/ui";
import { cn } from "../../utils/cn";
import { formatCurrency } from "../../utils/formatCurrency";
import { LABOUR_TYPES } from "../../utils/labourTypes";
import LabourTypeBadge from "../labours/LabourTypeBadge";
import { workLine } from "./workLine";

const PAGE_SIZE = 15;
const money = (value, extra) => <span className={cn(value < 0 && "text-danger", extra)}>{formatCurrency(value)}</span>;

/** One row per labour: work in the range, earned, received (both in the range) and outstanding (season to date). */
export default function SalaryTable({ rows }) {
  const [type, setType] = useState("ALL");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter(
      (r) => (type === "ALL" || r.labourType === type) && (!q || r.name.toLowerCase().includes(q) || r.id.toLowerCase().includes(q))
    );
  }, [rows, type, search]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const start = (currentPage - 1) * PAGE_SIZE;
  const pageRows = filtered.slice(start, start + PAGE_SIZE);

  const tabs = [
    { id: "ALL", label: "All", count: rows.length },
    ...[LABOUR_TYPES.BIGARI, LABOUR_TYPES.MAAPVALI, LABOUR_TYPES.PATLAVALE].map((t) => ({
      id: t,
      label: t.charAt(0) + t.slice(1).toLowerCase(),
      count: rows.filter((r) => r.labourType === t).length,
    })),
  ];

  const columns = [
    {
      key: "labour",
      header: "Labour",
      render: (r) => (
        <div>
          <p className="font-medium">{r.name}</p>
          <p className="mt-0.5 flex items-center gap-2 type-small">
            {r.id}
            <LabourTypeBadge type={r.labourType} />
          </p>
        </div>
      ),
    },
    {
      key: "work",
      header: "Work in range",
      render: (r) => {
        const w = workLine(r);
        return (
          <div>
            <p className="font-medium">{w.primary}</p>
            <p className="type-small">{w.secondary}</p>
          </div>
        );
      },
    },
    { key: "earned", header: "Earned", align: "right", render: (r) => formatCurrency(r.period.earned) },
    { key: "received", header: "Received", align: "right", render: (r) => formatCurrency(r.period.received) },
    { key: "outstanding", header: "Outstanding (season)", align: "right", render: (r) => money(r.season.balance, "font-semibold") },
  ];

  return (
    <Card>
      <CardHeader title="By Labour" icon={Wallet} action={<span className="type-small">{filtered.length} of {rows.length}</span>} />
      <CardBody className="space-y-4">
        <SearchInput value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Search by name or ID..." />
        <Tabs variant="pills" fullWidth tabs={tabs} value={type} onChange={(id) => { setType(id); setPage(1); }} />

        <ResponsiveTable
          columns={columns}
          data={pageRows}
          empty={<EmptyState icon={Wallet} title="No labour found" description="Try a different search or type." />}
          renderCard={(r) => {
            const w = workLine(r);
            return (
              <div className="space-y-2.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{r.name}</p>
                    <p className="mt-0.5 flex items-center gap-2 type-small">
                      {r.id}
                      <LabourTypeBadge type={r.labourType} />
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-xs text-fg-muted">Outstanding (season)</p>
                    <p className="text-base font-bold">{money(r.season.balance)}</p>
                  </div>
                </div>
                <p className="text-sm">
                  <span className="font-medium">{w.primary}</span> <span className="type-small">({w.secondary})</span>
                </p>
                <div className="grid grid-cols-2 gap-3 rounded-lg bg-background p-3 text-sm">
                  <div>
                    <p className="type-small">Earned (range)</p>
                    <p className="font-semibold">{formatCurrency(r.period.earned)}</p>
                  </div>
                  <div>
                    <p className="type-small">Received (range)</p>
                    <p className="font-semibold">{formatCurrency(r.period.received)}</p>
                  </div>
                </div>
              </div>
            );
          }}
        />
        <Pagination page={currentPage} pageCount={pageCount} onPageChange={setPage} />
      </CardBody>
    </Card>
  );
}
