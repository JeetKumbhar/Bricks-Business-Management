import { Plus, RotateCcw, Users, WifiOff } from "lucide-react";
import { useState } from "react";
import { Badge, Button, Card, CardBody, EmptyState, LoadingState, SearchInput, Table, Tabs } from "../components/ui";
import { canArchive, canEdit, canRestore, countByView, filterCustomers, INTERNAL_NAME } from "../features/customers/customerView";
import useCustomerManagement from "../features/customers/useCustomerManagement";

const dash = (v) => (v ? v : <span className="text-fg-muted">-</span>);

/**
 * Customers: who Pheera and invoices are for. Everything is read from and saved to the server (no sample customers). The built-in
 * "Internal / No Bill" customer (own-use and wastage trips, never invoiced) is shown but cannot be edited, archived or used for billing.
 */
export default function Customers() {
  const m = useCustomerManagement();
  const [view, setView] = useState("active");
  const [query, setQuery] = useState("");

  const counts = countByView(m.items);
  const rows = filterCustomers(m.items, { query, view });
  const internal = m.items.find((c) => c.isInternal && !c.isArchived);

  const actions = (c) => (
    <div className="flex items-center justify-end gap-1">
      {canEdit(c) && (
        <Button variant="ghost" size="sm" onClick={() => m.openEdit(c)} aria-label={`Edit ${c.name}`}>
          Edit
        </Button>
      )}
      {canArchive(c) && (
        <Button variant="ghost" size="sm" onClick={() => m.openArchive(c)} aria-label={`Archive ${c.name}`}>
          Archive
        </Button>
      )}
      {canRestore(c) && (
        <Button variant="outline" size="sm" leftIcon={RotateCcw} loading={m.restoringId === c.id} disabled={Boolean(m.restoringId) || m.submitting} onClick={() => m.restore(c)} aria-label={`Restore ${c.name}`}>
          Restore
        </Button>
      )}
    </div>
  );

  const statusBadge = (c) =>
    c.isInternal ? (
      <Badge variant="neutral" size="sm">Built-in, never invoiced</Badge>
    ) : c.isArchived ? (
      <Badge variant="warning" size="sm">Archived</Badge>
    ) : (
      <Badge variant="success" size="sm">Active</Badge>
    );

  const columns = [
    { key: "name", header: "Name", render: (c) => <span className="font-medium">{c.name}</span> },
    { key: "contact", header: "Contact", render: (c) => dash(c.contact) },
    { key: "gstin", header: "GSTIN", render: (c) => dash(c.gstin) },
    { key: "state", header: "State", render: (c) => dash(c.stateName) },
    { key: "status", header: "Status", render: statusBadge },
    ...(view === "archived" ? [{ key: "reason", header: "Archived because", render: (c) => dash(c.archivedReason) }] : []),
    { key: "actions", header: "", align: "right", render: actions },
  ];

  let body;
  if (m.status === "loading") body = <LoadingState label="Loading customers..." />;
  else if (m.status === "error")
    body = (
      <Card>
        <EmptyState icon={WifiOff} title="Could not load the customers" description={`${m.loadError} Nothing has been changed.`} action={<Button onClick={m.reload}>Try again</Button>} />
      </Card>
    );
  else if (rows.length === 0)
    body = (
      <Card>
        <EmptyState
          icon={Users}
          title={query ? "No customer found" : view === "archived" ? "No archived customers" : "No customers yet"}
          description={query ? "Try a different search." : view === "archived" ? "Archived customers appear here and can be restored." : "Add your first customer. Every Pheera and invoice needs one."}
          action={!query && view === "active" ? <Button leftIcon={Plus} onClick={m.openAdd}>Add Customer</Button> : undefined}
        />
      </Card>
    );
  else
    body = (
      <>
        <ul className="divide-y divide-border rounded-xl border border-border bg-surface md:hidden">
          {rows.map((c) => (
            <li key={c.id} className="space-y-1.5 px-4 py-3">
              <div className="flex items-start justify-between gap-2">
                <p className="font-semibold">{c.name}</p>
                {statusBadge(c)}
              </div>
              <p className="type-small">{[c.contact, c.stateName, c.gstin].filter(Boolean).join(" | ") || "No details"}</p>
              {view === "archived" && c.archivedReason && <p className="type-small">Archived because: {c.archivedReason}</p>}
              {actions(c)}
            </li>
          ))}
        </ul>
        <div className="hidden md:block">
          <Table columns={columns} data={rows} rowKey="id" />
        </div>
      </>
    );

  return (
    <div className="space-y-4 sm:space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="type-page-heading">Customers</h1>
          <p className="mt-1 text-sm text-fg-muted">Who Pheera and invoices are for. Archive instead of deleting: old records keep their customer.</p>
        </div>
        <Button leftIcon={Plus} onClick={m.openAdd} disabled={m.status !== "ready"} className="self-start">
          Add Customer
        </Button>
      </div>

      {m.status === "ready" && !internal && (
        <Card>
          <CardBody className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm">
              <strong>{INTERNAL_NAME}</strong> is not enabled. It is for the business&apos;s own trips and wastage, and is never invoiced.
            </p>
            <Button variant="outline" size="sm" onClick={m.enableInternal} loading={m.enabling} disabled={m.enabling}>
              Enable {INTERNAL_NAME}
            </Button>
          </CardBody>
        </Card>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Tabs
          tabs={[
            { id: "active", label: "Active", count: counts.active },
            { id: "archived", label: "Archived", count: counts.archived },
          ]}
          value={view}
          onChange={setView}
        />
        <SearchInput value={query} onChange={setQuery} placeholder="Search name, contact, GSTIN..." className="sm:w-80" />
      </div>

      {body}
      {m.modals}
    </div>
  );
}
