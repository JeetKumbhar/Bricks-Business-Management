import { Boxes } from "lucide-react";
import { Card, CardBody, CardHeader } from "../../../components/ui";
import { formatCurrency, formatNumber } from "../../../utils/formatCurrency";
import { estimateBricks } from "../../../utils/workCalculations";

function Tile({ label, value }) {
  return (
    <div className="rounded-lg bg-violet-50 p-3 text-violet-700">
      <p className="text-xs font-medium opacity-80">{label}</p>
      <p className="mt-1 text-2xl font-bold leading-none">{value}</p>
    </div>
  );
}

/** Maapvali work totals: maaps, work days, rate and earnings. The brick estimate is information only. */
export default function MaapStatsCard({ labour, className }) {
  return (
    <Card className={className}>
      <CardHeader title="Maap Work" subtitle="Season to date" icon={Boxes} />
      <CardBody>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Tile label="Total Maaps" value={formatNumber(labour.totalMaaps)} />
          <Tile label="Work Days" value={labour.workDays} />
          <Tile label="Rate per Maap" value={formatCurrency(labour.ratePerMaap)} />
          <Tile label="Earned" value={formatCurrency(labour.earned)} />
        </div>
        <p className="type-small mt-3">
          About {formatNumber(estimateBricks(labour.totalMaaps))} bricks moved (maaps x 275). For information only: earnings =
          maaps x rate per maap.
        </p>
      </CardBody>
    </Card>
  );
}
