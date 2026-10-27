import { Factory } from "lucide-react";
import { Card, CardBody, CardHeader } from "../../components/ui";
import { formatNumber } from "../../utils/formatCurrency";
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
        <div className="grid gap-2 rounded-lg bg-background p-3 text-sm sm:grid-cols-3">
          <p>
            <span className="font-semibold">Maaps</span> = what the teams recorded ({formatNumber(production.season.totalMaaps)}). 4 maaps =
            1,100 bricks made.
          </p>
          <p>
            <span className="font-semibold">Physical</span> = bricks made ({formatNumber(production.season.totalPhysicalBricks)}).
          </p>
          <p>
            <span className="font-semibold">Payable</span> = bricks the teams are paid for: 250 for every maap (
            {formatNumber(production.season.totalPayableBricks)}).
          </p>
        </div>
      </CardBody>
    </Card>
  );
}
