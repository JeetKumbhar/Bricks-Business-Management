import { Factory } from "lucide-react";
import { Card, CardBody, CardHeader } from "../../components/ui";
import ProductionSummary from "../production/ProductionSummary";
import ViewAllButton from "./ViewAllButton";

/**
 * Season production of all Patlavale teams.
 * Maaps, physical bricks (made) and payable bricks (paid for) are shown as separate numbers.
 * Payments never change any of them.
 */
export default function PatlavaleProductionCard({ production, className }) {
  return (
    <Card className={className}>
      <CardHeader
        title="Patlavale Production"
        subtitle={`${production.activeTeams} active ${production.activeTeams === 1 ? "team" : "teams"}`}
        icon={Factory}
        action={<ViewAllButton to="/patlavale-production" />}
      />
      <CardBody className="space-y-3">
        <ProductionSummary summary={production.season} scope={`All ${production.teams} teams`} />
      </CardBody>
    </Card>
  );
}
