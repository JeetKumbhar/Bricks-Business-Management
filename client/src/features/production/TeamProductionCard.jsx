import { Link } from "react-router-dom";
import { Factory } from "lucide-react";
import { Card, CardBody, CardHeader } from "../../components/ui";
import { summarizeProduction } from "../../utils/productionCalculations";
import useProduction from "./useProduction";
import ProductionLedger from "./ProductionLedger";
import ProductionSummary from "./ProductionSummary";

/** One team's season totals and ledger (newest first). Used on the team's profile. */
export default function TeamProductionCard({ team }) {
  const { entries } = useProduction();
  const teamEntries = entries.filter((e) => e.teamId === team.id); // oldest first
  const summary = summarizeProduction(teamEntries);

  return (
    <Card>
      <CardHeader
        title="Production Ledger"
        subtitle={`${teamEntries.length} ${teamEntries.length === 1 ? "entry" : "entries"}`}
        icon={Factory}
        action={
          <Link to="/patlavale-production" className="text-sm font-medium text-primary">
            Add entry
          </Link>
        }
      />
      <CardBody className="space-y-4">
        <ProductionSummary summary={summary} />
        <ProductionLedger
          entries={[...teamEntries].reverse()}
          showTeam={false}
          emptyTitle="No production recorded yet"
          emptyDescription="Production recorded for this team will be listed here."
        />
      </CardBody>
    </Card>
  );
}
