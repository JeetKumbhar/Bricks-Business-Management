import { Ban, CheckCircle2, Download, Eye, Pencil, Printer } from "lucide-react";
import { Badge, Button, Dropdown, EmptyState } from "../../components/ui";
import ResponsiveTable from "../../components/common/ResponsiveTable";
import { formatDate } from "../../utils/formatDate";
import { formatRupees } from "../../utils/money";
import { BILL_STATUS } from "./billModel";
import { billLabel, billTotals } from "./billSelectors";
import BillStatusBadge from "./BillStatusBadge";

// The table is wider than a tablet screen, so the Actions column stays pinned on the right while the rest scrolls sideways.
const STICKY_CELL = "sticky right-0 z-10 bg-surface shadow-[-8px_0_8px_-8px_rgba(0,0,0,0.18)]";
const STICKY_HEAD = "sticky right-0 z-10 bg-background shadow-[-8px_0_8px_-8px_rgba(0,0,0,0.18)]";

/**
 * Bills history. Actions: View, Edit (draft only), Print, Download PDF, and under the menu Finalize (draft) and
 * Cancel (draft or finalized). Finalized and cancelled bills are read-only.
 */
export default function BillsTable({ bills, onView, onEdit, onPrint, onDownload, onFinalize, onCancel }) {
  const totals = (b) => billTotals(b);

  const actions = (b) => {
    const draft = b.status === BILL_STATUS.DRAFT;
    const menu = [
      ...(draft ? [{ label: "Finalize", icon: CheckCircle2, onClick: () => onFinalize(b) }] : []),
      ...(b.status !== BILL_STATUS.CANCELLED ? [{ label: draft ? "Discard draft" : "Cancel bill", icon: Ban, variant: "danger", onClick: () => onCancel(b) }] : []),
    ];
    return (
      <div className="flex items-center justify-end gap-0.5">
        <Button variant="ghost" size="sm" aria-label={`View bill ${billLabel(b)}`} onClick={() => onView(b)}>
          <Eye className="h-4 w-4" aria-hidden="true" />
        </Button>
        {draft && (
          <Button variant="ghost" size="sm" aria-label={`Edit bill ${billLabel(b)}`} onClick={() => onEdit(b)}>
            <Pencil className="h-4 w-4" aria-hidden="true" />
          </Button>
        )}
        <Button variant="ghost" size="sm" aria-label={`Print bill ${billLabel(b)}`} onClick={() => onPrint(b)}>
          <Printer className="h-4 w-4" aria-hidden="true" />
        </Button>
        <Button variant="ghost" size="sm" aria-label={`Download PDF of bill ${billLabel(b)}`} onClick={() => onDownload(b)}>
          <Download className="h-4 w-4" aria-hidden="true" />
        </Button>
        {menu.length > 0 && <Dropdown items={menu} />}
      </div>
    );
  };

  const numberCell = (b) => (
    <span className="inline-flex flex-col items-start gap-1 whitespace-nowrap font-medium">
      {b.billNumber ?? <span className="font-normal text-fg-muted">Draft</span>}
      {b.isDemo && (
        <Badge variant="neutral" size="sm">
          Demo
        </Badge>
      )}
    </span>
  );

  // most important first (total and status), so they stay visible when a narrow screen scrolls sideways
  const columns = [
    { key: "number", header: "Bill No.", render: numberCell, className: "whitespace-nowrap" },
    { key: "billDate", header: "Bill Date", render: (b) => formatDate(b.billDate) },
    { key: "customer", header: "Customer", render: (b) => (
        <div className="min-w-40">
          <p className="font-medium">{b.customer.name || <span className="text-fg-muted">-</span>}</p>
          <p className="type-small">{b.customer.gstin ? `GSTIN ${b.customer.gstin}` : "No GSTIN"}</p>
        </div>
      ) },
    { key: "grand", header: "Grand Total", align: "right", render: (b) => <span className="font-semibold">{formatRupees(totals(b).grandPaise)}</span>, className: "whitespace-nowrap", headerClassName: "whitespace-nowrap" },
    { key: "status", header: "Status", render: (b) => <BillStatusBadge status={b.status} /> },
    { key: "taxable", header: "Taxable Amount", align: "right", render: (b) => formatRupees(totals(b).taxablePaise), className: "whitespace-nowrap", headerClassName: "whitespace-nowrap" },
    { key: "gst", header: "GST", align: "right", render: (b) => formatRupees(totals(b).taxPaise), className: "whitespace-nowrap" },
    { key: "actions", header: "Actions", align: "right", render: actions, className: STICKY_CELL, headerClassName: STICKY_HEAD },
  ];

  const renderCard = (b) => (
    <div className="space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-semibold">{b.customer.name || "(no customer yet)"}</p>
          <p className="type-small">{numberCell(b)}</p>
        </div>
        <BillStatusBadge status={b.status} />
      </div>
      <div className="flex items-center justify-between text-sm">
        <span className="text-fg-muted">{formatDate(b.billDate)}</span>
        <span className="font-semibold">{formatRupees(totals(b).grandPaise)}</span>
      </div>
      <p className="type-small">
        Taxable {formatRupees(totals(b).taxablePaise)} - GST {formatRupees(totals(b).taxPaise)}
        {b.customer.gstin ? ` - ${b.customer.gstin}` : ""}
      </p>
      <div className="-mx-2 border-t border-border pt-1">{actions(b)}</div>
    </div>
  );

  return (
    <>
      <p className="type-small mb-2 hidden md:block 2xl:hidden">Scroll sideways to see every column. Actions stay in view on the right.</p>
      <ResponsiveTable columns={columns} data={bills} rowKey="id" renderCard={renderCard} empty={<EmptyState title="No bills found" />} />
    </>
  );
}
