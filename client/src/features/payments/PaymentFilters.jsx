import { Card, CardBody, SearchInput, Tabs } from "../../components/ui";

/** Search (labour name / ID / note) + payment type filter. */
export default function PaymentFilters({ search, onSearchChange, type, onTypeChange, counts }) {
  const tabs = [
    { id: "ALL", label: "All", count: counts.ALL },
    { id: "BOOKING_ADVANCE", label: "Advance", count: counts.BOOKING_ADVANCE },
    { id: "SALARY_PAYMENT", label: "Salary", count: counts.SALARY_PAYMENT },
    { id: "OTHER", label: "Other", count: counts.OTHER },
  ];

  return (
    <Card>
      <CardBody className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <SearchInput
          className="w-full lg:max-w-md"
          value={search}
          onChange={onSearchChange}
          placeholder="Search by labour, ID or note..."
        />
        <Tabs variant="pills" fullWidth className="lg:w-auto" tabs={tabs} value={type} onChange={onTypeChange} />
      </CardBody>
    </Card>
  );
}
