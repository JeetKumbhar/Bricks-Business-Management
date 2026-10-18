import { Info } from "lucide-react";
import { Card, CardBody, CardHeader } from "../../components/ui";
import { settlementQuestions } from "../../mock/salary";

/** There is no settlement action yet: the client has to confirm the procedure first. */
export default function SettlementNotice() {
  return (
    <Card>
      <CardHeader title="Season Settlement" subtitle="Not available yet" icon={Info} />
      <CardBody>
        <p className="text-sm text-fg-muted">
          How a season is settled has not been confirmed with the client, so there is no settlement button yet. These need an
          answer first:
        </p>
        <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-sm">
          {settlementQuestions.map((q) => (
            <li key={q}>{q}</li>
          ))}
        </ol>
      </CardBody>
    </Card>
  );
}
