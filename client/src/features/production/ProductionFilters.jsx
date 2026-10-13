import { Card, CardBody, Select, Tabs } from "../../components/ui";

/** Team selector (All teams or one team) and a period filter for the ledger. */
export default function ProductionFilters({ teams, teamId, onTeamChange, period, onPeriodChange }) {
  const periods = [
    { id: "ALL", label: "All" },
    { id: "TODAY", label: "Today" },
    { id: "WEEK", label: "Last 7 days" },
  ];

  return (
    <Card>
      <CardBody className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <Select
          label="Family / Team"
          value={teamId}
          onChange={(e) => onTeamChange(e.target.value)}
          options={[{ value: "ALL", label: "All teams" }, ...teams.map((t) => ({ value: t.id, label: `${t.name} (${t.id})` }))]}
          wrapperClassName="lg:w-80"
        />
        <Tabs variant="pills" fullWidth className="lg:w-auto" tabs={periods} value={period} onChange={onPeriodChange} />
      </CardBody>
    </Card>
  );
}
