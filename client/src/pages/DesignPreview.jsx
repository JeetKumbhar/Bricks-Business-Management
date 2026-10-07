// TEMPORARY page to eyeball the design system. Delete it once Phase 3 layouts exist.
import { useState } from "react";
import { Clock, Eye, Pencil, Plus, Trash2, Truck, UserCheck, UserX, Users, Wallet } from "lucide-react";
import {
  Badge, Button, Card, CardBody, CardHeader, ConfirmDialog, DatePicker, Dropdown, EmptyState,
  Input, LoadingState, Modal, SearchInput, Select, StatCard, Table, Tabs, Textarea, ToastProvider, useToast,
} from "../components/ui";

const swatches = [
  ["Primary", "bg-primary"], ["Secondary", "bg-secondary"], ["Background", "bg-background border border-border"],
  ["Surface", "bg-surface border border-border"], ["Text", "bg-fg"], ["Muted Text", "bg-fg-muted"],
  ["Success", "bg-success"], ["Warning", "bg-warning"], ["Danger", "bg-danger"], ["Border", "bg-border"],
];

const rows = [
  { id: "L-001", name: "Ramesh Kumar", rate: 650, status: "Active" },
  { id: "L-002", name: "Suresh Singh", rate: 700, status: "Active" },
  { id: "L-008", name: "Sanjay Gupta", rate: 600, status: "Half Day" },
  { id: "L-009", name: "Mahesh Sawant", rate: 650, status: "Inactive" },
];
const statusVariant = { Active: "success", "Half Day": "warning", Inactive: "danger" };

function Section({ title, children }) {
  return (
    <section className="space-y-3">
      <h2 className="type-section-heading">{title}</h2>
      {children}
    </section>
  );
}

function Preview() {
  const toast = useToast();
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState("all");
  const [pillTab, setPillTab] = useState("week");
  const [selected, setSelected] = useState([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const columns = [
    { key: "id", header: "ID" },
    { key: "name", header: "Name" },
    { key: "rate", header: "Rate (₹)", align: "right" },
    { key: "status", header: "Status", render: (r) => <Badge variant={statusVariant[r.status]}>{r.status}</Badge> },
    {
      key: "actions", header: "Actions", align: "right",
      render: (r) => (
        <Dropdown
          items={[
            { label: "View", icon: Eye, onClick: () => toast.info(`Viewing ${r.name}`) },
            { label: "Edit", icon: Pencil, onClick: () => toast.success(`Editing ${r.name}`) },
            { type: "divider" },
            { label: "Delete", icon: Trash2, variant: "danger", onClick: () => setConfirmOpen(true) },
          ]}
        />
      ),
    },
  ];

  return (
    <div className="mx-auto max-w-5xl space-y-8 p-4 sm:p-8">
      <h1 className="type-page-heading">BrickPro Design System</h1>

      <Section title="Colors">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {swatches.map(([name, cls]) => (
            <div key={name} className="space-y-1.5">
              <div className={`h-12 rounded-lg ${cls}`} />
              <p className="type-small">{name}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Typography">
        <Card><CardBody className="space-y-2">
          <p className="type-page-heading">Page Heading</p>
          <p className="type-section-heading">Section Heading</p>
          <p className="type-card-heading">Card Heading</p>
          <p className="type-body">Body text - Ramesh Kumar marked present.</p>
          <p className="type-small">Small text - 2 hours ago</p>
          <p className="type-table">Table text - ₹1,23,456</p>
          <p className="type-button">Button text</p>
        </CardBody></Card>
      </Section>

      <Section title="Buttons">
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" leftIcon={Plus}>Add Labour</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="success">Success</Button>
          <Button variant="danger">Danger</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="ghost">Ghost</Button>
          <Button loading>Saving</Button>
          <Button disabled>Disabled</Button>
          <Button size="sm">Small</Button>
          <Button size="lg">Large</Button>
        </div>
      </Section>

      <Section title="Stat cards">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard title="Total Labour" value="48" icon={Users} color="blue" actionLabel="View All" />
          <StatCard title="Present Today" value="42" icon={UserCheck} color="green" actionLabel="View Attendance" />
          <StatCard title="Half Days Today" value="3" icon={Clock} color="yellow" actionLabel="View Attendance" />
          <StatCard title="Absent Today" value="3" icon={UserX} color="red" actionLabel="View Attendance" />
          <StatCard title="Working Trucks" value="7 / 10" icon={Truck} color="purple" actionLabel="View Trucks" />
          <StatCard variant="soft" title="Active Labour" value="42" icon={UserCheck} color="green" actionLabel="View Active" />
          <StatCard variant="soft" title="Inactive Labour" value="3" icon={UserX} color="red" actionLabel="View Inactive" />
          <StatCard variant="soft" title="This Week Salary" value="₹82,500" icon={Wallet} color="blue" />
        </div>
      </Section>

      <Section title="Form controls">
        <Card><CardBody className="grid gap-4 sm:grid-cols-2">
          <Input label="Name" required placeholder="Labour name" />
          <Input label="Mobile" hint="10-digit number" placeholder="9876543210" />
          <Input label="Daily rate (₹)" type="number" error="Rate is required" />
          <Select label="Status" placeholder="All" options={[{ value: "ACTIVE", label: "Active" }, { value: "INACTIVE", label: "Inactive" }]} />
          <DatePicker label="Joining date" />
          <SearchInput value={search} onChange={setSearch} placeholder="Search by name, ID or mobile number..." className="self-end" />
          <Textarea label="Note" wrapperClassName="sm:col-span-2" placeholder="Optional note" />
        </CardBody></Card>
      </Section>

      <Section title="Tabs and badges">
        <div className="space-y-3">
          <Tabs value={tab} onChange={setTab} tabs={[{ id: "all", label: "All", count: 48 }, { id: "active", label: "Active", count: 42 }, { id: "inactive", label: "Inactive", count: 3 }]} />
          <Tabs variant="pills" value={pillTab} onChange={setPillTab} tabs={[{ id: "week", label: "This Week" }, { id: "month", label: "This Month" }]} />
          <div className="flex flex-wrap gap-2">
            <Badge variant="success" dot>Present</Badge>
            <Badge variant="warning" dot>Half Day</Badge>
            <Badge variant="danger" dot>Absent</Badge>
            <Badge variant="info">Info</Badge>
            <Badge variant="purple">Maintenance</Badge>
            <Badge>Neutral</Badge>
          </div>
        </div>
      </Section>

      <Section title="Table, dropdown">
        <Table columns={columns} data={rows} selectable selectedKeys={selected} onSelectionChange={setSelected} />
        <Table columns={columns} data={[]} empty={<EmptyState title="No labour found" description="Try a different search." action={<Button leftIcon={Plus}>Add Labour</Button>} />} />
        <Table columns={columns} data={[]} loading skeletonRows={3} />
      </Section>

      <Section title="Overlays and feedback">
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setModalOpen(true)}>Open modal</Button>
          <Button variant="outline" onClick={() => setConfirmOpen(true)}>Open confirm</Button>
          <Button variant="outline" onClick={() => toast.success("Attendance saved")}>Success toast</Button>
          <Button variant="outline" onClick={() => toast.error("Could not save payment", { title: "Error" })}>Error toast</Button>
          <Button variant="outline" onClick={() => toast.warning("Truck TRK-04 stopped")}>Warning toast</Button>
        </div>
        <Card><LoadingState label="Loading labour..." /></Card>
      </Section>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Add Labour" description="Fill in the labour details."
        footer={<><Button variant="outline" onClick={() => setModalOpen(false)}>Cancel</Button><Button onClick={() => { setModalOpen(false); toast.success("Labour added"); }}>Save</Button></>}>
        <div className="space-y-4"><Input label="Name" required autoFocus /><Input label="Mobile" required /></div>
      </Modal>

      <ConfirmDialog open={confirmOpen} title="Delete payment?" message="The balance will be recalculated." confirmText="Delete" requireReason
        onCancel={() => setConfirmOpen(false)} onConfirm={(reason) => { setConfirmOpen(false); toast.success(`Deleted (${reason})`); }} />
    </div>
  );
}

export default function DesignPreview() {
  return (
    <ToastProvider>
      <Preview />
    </ToastProvider>
  );
}
