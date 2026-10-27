import { Factory } from "lucide-react";
import { Card, CardBody, CardHeader } from "../../../components/ui";
import ProductionSummary from "../../production/ProductionSummary";

/** Season production of a Patlavale team: maaps, physical, payable and earnings, shown separately. */
export default function ProductionStatsCard({ labour, className }) {
  const summary = {
    totalPhysicalBricks: labour.totalPhysicalBricks,
    totalPayableBricks: labour.totalPayableBricks,
    totalMaaps: labour.totalMaaps,
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
