import { Link } from "react-router-dom";
import { ArrowLeft, Users } from "lucide-react";
import { Badge, Card, CardBody, CardHeader } from "../../../components/ui";
import { cn } from "../../../utils/cn";
import { formatCurrency, formatNumber } from "../../../utils/formatCurrency";
import { formatDate } from "../../../utils/formatDate";
import { formatRate } from "../../../utils/formatRate";
import { LABOUR_STATUS_META } from "../../../utils/labourStatus";
import { LABOUR_TYPE_META, LABOUR_TYPES } from "../../../utils/labourTypes";
import MaapWorkHistoryCard from "../../work/maapvali/MaapWorkHistoryCard";
import LabourAvatar from "../LabourAvatar";
import LabourTypeBadge from "../LabourTypeBadge";

function Row({ label, children }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
      <dt className="text-fg-muted">{label}</dt>
      <dd className="text-right font-medium">{children}</dd>
    </div>
  );
}

function Figure({ label, value, danger }) {
  return (
    <div className="rounded-lg bg-background p-3">
      <p className="text-xs text-fg-muted">{label}</p>
      <p className={cn("mt-0.5 text-base font-bold", danger && "text-danger")}>{value}</p>
    </div>
  );
}

/**
 * Simple profile for a Maapvali worker or a Patlavale team.
 * Their full profiles (maap entries / production ledger) are built in later phases.
 */
export default function OtherTypeProfile({ worker }) {
  const meta = LABOUR_TYPE_META[worker.labourType];
  const status = LABOUR_STATUS_META[worker.status];
  const isTeam = worker.labourType === LABOUR_TYPES.PATLAVALE;

  return (
    <div className="space-y-4">
      <Link to="/labours" className="inline-flex items-center gap-1.5 py-1 text-sm font-medium text-primary">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Labour list
      </Link>

      <Card>
        <CardBody className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3 sm:gap-4">
            <LabourAvatar worker={worker} className="h-14 w-14 text-lg sm:h-16 sm:w-16" />
            <div className="min-w-0">
              <h1 className="truncate text-xl font-bold tracking-tight sm:text-2xl">{worker.name}</h1>
              <p className="type-small">
                {worker.id} - {worker.village}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <LabourTypeBadge type={worker.labourType} />
                <Badge variant={status.variant} size="sm">
                  {status.label}
                </Badge>
              </div>
            </div>
          </div>
          <div
            className={cn(
              "flex items-center justify-between gap-6 rounded-lg px-4 py-3 lg:min-w-64",
              worker.balance < 0 ? "bg-danger-soft" : "bg-background"
            )}
          >
            <span className="text-sm text-fg-muted">{worker.balance < 0 ? "Overpaid" : "Balance"}</span>
            <span className={cn("text-xl font-bold", worker.balance < 0 && "text-danger")}>{formatCurrency(worker.balance)}</span>
          </div>
        </CardBody>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title={isTeam ? "Team Details" : "Worker Details"} icon={Users} />
          <CardBody>
            <dl className="divide-y divide-border text-sm">
              <Row label="Labour Type">{meta.label}</Row>
              <Row label={meta.mobileLabel}>
                <a href={`tel:${worker.mobile}`} className="text-primary">
                  {worker.mobile}
                </a>
              </Row>
              <Row label="Village">{worker.village}</Row>
              <Row label="Joining Date">{formatDate(worker.joiningDate)}</Row>
              <Row label={meta.rateLabel}>{formatRate(worker)}</Row>
            </dl>
            {isTeam && (
              <p className="type-small mt-3">One salary account for the whole family. Members are for reference and are not paid separately.</p>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={isTeam ? "Production" : "Maap Work"} subtitle="Season to date" />
          <CardBody className="space-y-3">
            {isTeam ? (
              <div className="grid grid-cols-3 gap-2">
                <Figure label="Physical bricks" value={formatNumber(worker.totalPhysicalBricks)} />
                <Figure label="Payable bricks" value={formatNumber(worker.totalPayableBricks)} />
                <Figure label="Carry-forward" value={formatNumber(worker.carryForwardBricks)} />
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <Figure label="Total maaps" value={formatNumber(worker.totalMaaps)} />
                <Figure label="Work days" value={worker.workDays} />
              </div>
            )}
            <div className="grid grid-cols-3 gap-2">
              <Figure label="Earned" value={formatCurrency(worker.earned)} />
              <Figure label="Received" value={formatCurrency(worker.totalReceived)} />
              <Figure label="Balance" value={formatCurrency(worker.balance)} danger={worker.balance < 0} />
            </div>
            <p className="type-small">Prototype calculation. Final salary figures are calculated by the server.</p>
          </CardBody>
        </Card>
      </div>

      {worker.labourType === LABOUR_TYPES.MAAPVALI && <MaapWorkHistoryCard worker={worker} />}

      {isTeam && worker.members?.length > 0 && (
        <Card>
          <CardHeader title="Family Members" subtitle="Reference only" />
          <CardBody>
            <ul className="divide-y divide-border text-sm">
              {worker.members.map((m) => (
                <li key={m.name} className="flex items-center justify-between py-2.5 first:pt-0 last:pb-0">
                  <span className="font-medium">{m.name}</span>
                  <span className="text-fg-muted">{m.relation}</span>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}

      {isTeam && (
        <p className="type-small">The full Patlavale profile (production ledger, payments and history) is added in an upcoming phase.</p>
      )}
    </div>
  );
}
