import { Card, CardBody, SearchInput, Tabs } from "../../../components/ui";

export default function MaapFilters({ search, onSearchChange, period, onPeriodChange }) {
  const tabs = [
    { id: "ALL", label: "All" },
    { id: "TODAY", label: "Today" },
    { id: "WEEK", label: "Last 7 days" },
  ];

  return (
    <Card>
      <CardBody className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <SearchInput
          className="w-full lg:max-w-md"
          value={search}
          onChange={onSearchChange}
          placeholder="Search by worker, ID or note..."
        />
        <Tabs variant="pills" fullWidth className="lg:w-auto" tabs={tabs} value={period} onChange={onPeriodChange} />
      </CardBody>
    </Card>
  );
}
