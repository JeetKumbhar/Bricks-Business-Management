import { History, TrendingUp } from "lucide-react";
import { Badge, Button, Card, CardBody, CardHeader } from "../../../components/ui";
import { cn } from "../../../utils/cn";
import { formatCurrency } from "../../../utils/formatCurrency";
import { addDaysISO, formatDate, toISODate } from "../../../utils/formatDate";
import { getRate } from "../../../utils/formatRate";
import { LABOUR_TYPE_META } from "../../../utils/labourTypes";

/**
 * Rate history for any type (daily rate, rate per maap, or team rate per 1,000 payable bricks).
 * history: newest first. Past work keeps the rate it was recorded at.
 * Pass onChangeRate to show the "Change Rate" button. It is only offered for Bigari for now:
 * rate changes for Maapvali and Patlavale are still to be confirmed with the client.
 */
export default function RateHistoryTab({ labour, history, onChangeRate }) {
  const meta = LABOUR_TYPE_META[labour.labourType];
  const today = toISODate();
  const current = history.find((entry) => entry.effectiveFrom <= today) ?? history[history.length - 1];

  return (
    <div className="space-y-4">
      <Card>
        <CardBody className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs text-fg-muted">Current {meta.rateLabel.toLowerCase()}</p>
            <p className="text-3xl font-bold">
              {formatCurrency(getRate(labour))} <span className="text-base font-normal text-fg-muted">{meta.rateUnitShort}</span>
            </p>
            {current && <p className="type-small mt-1">Since {formatDate(current.effectiveFrom)}</p>}
          </div>
          {onChangeRate ? (
            // TODO (auth phase): show only for the Owner role.
            <Button leftIcon={TrendingUp} onClick={onChangeRate} className="w-full sm:w-auto">
              Change Rate
            </Button>
          ) : (
            <p className="type-small max-w-xs">Rate changes for this type are not available yet. New entries use the rate shown here.</p>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Rate History" subtitle={`${history.length} ${history.length === 1 ? "entry" : "entries"}`} icon={History} />
        <CardBody>
          <ol className="relative space-y-4 border-l-2 border-border pl-5">
            {history.map((entry, index) => {
              const newer = index > 0 ? history[index - 1] : null;
              const until = newer ? formatDate(addDaysISO(newer.effectiveFrom, -1)) : "Present";
              const isCurrent = entry.id === current?.id;
              const isScheduled = entry.effectiveFrom > today;

              return (
                <li key={entry.id} className="relative">
                  <span
                    className={cn(
                      "absolute -left-[27px] top-4 h-3 w-3 rounded-full border-2 border-surface",
                      isCurrent ? "bg-primary" : "bg-border"
                    )}
                    aria-hidden="true"
                  />
                  <div className="rounded-lg border border-border p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-base font-semibold">
                        {formatCurrency(entry.rate)} <span className="text-sm font-normal text-fg-muted">{meta.rateUnitShort}</span>
                      </p>
                      {isCurrent && (
                        <Badge variant="success" size="sm">
                          Current
                        </Badge>
                      )}
                      {isScheduled && (
                        <Badge variant="info" size="sm">
                          Scheduled
                        </Badge>
                      )}
                    </div>
                    <p className="type-small mt-1">
                      {formatDate(entry.effectiveFrom)} - {until}
                    </p>
                    <p className="mt-2 text-sm">{entry.reason}</p>
                    <p className="type-small mt-1">Changed by {entry.changedBy}</p>
                  </div>
                </li>
              );
            })}
          </ol>
        </CardBody>
      </Card>
    </div>
  );
}
