import { Card, CardBody, SearchInput, Tabs } from "../../components/ui";

export default function TruckFilters({ search, onSearchChange, status, onStatusChange, summary }) {
  const tabs = [
    { id: "ALL", label: "All", count: summary.total },
    { id: "WORKING", label: "Working", count: summary.working },
    { id: "STOPPED", label: "Stopped", count: summary.stopped },
    { id: "MAINTENANCE", label: "Maintenance", count: summary.maintenance },
  ];

  return (
    <Card>
      <CardBody className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <SearchInput className="w-full lg:max-w-md" value={search} onChange={onSearchChange} placeholder="Search by truck number, model or driver..." />
        <Tabs variant="pills" fullWidth className="lg:w-auto" tabs={tabs} value={status} onChange={onStatusChange} />
      </CardBody>
    </Card>
  );
}
