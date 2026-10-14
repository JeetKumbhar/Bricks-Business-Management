import { Factory } from "lucide-react";
import { Card, CardBody, CardHeader } from "../../../components/ui";
import ProductionSummary from "../../production/ProductionSummary";

/** Season production of a Patlavale team: physical, payable, carry-forward and earnings, shown separately. */
export default function ProductionStatsCard({ labour, className }) {
  const summary = {
    totalPhysicalBricks: labour.totalPhysicalBricks,
    totalPayableBricks: labour.totalPayableBricks,
    carryForwardBricks: labour.carryForwardBricks,
    totalEarnings: labour.earned,
  };

  return (
    <Card className={className}>
      <CardHeader title="Production" icon={Factory} />
      <CardBody>
        <ProductionSummary summary={summary} />
      </CardBody>
    </Card>
  );
}
