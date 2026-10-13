import { Link } from "react-router-dom";
import { Boxes } from "lucide-react";
import { Card, CardBody, CardHeader } from "../../../components/ui";
import { formatCurrency, formatNumber } from "../../../utils/formatCurrency";
import { summarizeMaapWork } from "../../../utils/workCalculations";
import useLabours from "../../labours/useLabours";
import MaapEntryList from "./MaapEntryList";

/** One Maapvali worker's work history: date, maaps, rate and earnings. Used on the worker's profile. */
export default function MaapWorkHistoryCard({ worker }) {
  const { getMaapEntries } = useLabours();
  const entries = getMaapEntries(worker.id).map((e) => ({ ...e, workerName: worker.name }));
  const totals = summarizeMaapWork(entries);

  return (
    <Card>
      <CardHeader
        title="Work History"
        subtitle={`${entries.length} ${entries.length === 1 ? "entry" : "entries"}`}
        icon={Boxes}
        action={
          <Link to="/maapvali-work" className="text-sm font-medium text-primary">
            Add work
          </Link>
        }
      />
      <CardBody className="space-y-4">
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-lg bg-background p-3">
            <p className="text-xs text-fg-muted">Total maaps</p>
            <p className="mt-0.5 text-base font-bold">{formatNumber(totals.maaps)}</p>
          </div>
          <div className="rounded-lg bg-background p-3">
            <p className="text-xs text-fg-muted">Total earnings</p>
            <p className="mt-0.5 text-base font-bold">{formatCurrency(totals.earnings)}</p>
          </div>
        </div>
        <MaapEntryList
          entries={entries}
          showWorker={false}
          emptyTitle="No work recorded yet"
          emptyDescription="Maaps recorded for this worker will be listed here."
        />
      </CardBody>
    </Card>
  );
}
