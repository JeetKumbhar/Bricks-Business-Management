import { Cog, ListChecks, Info, UserRound } from "lucide-react";
import { Card, CardBody } from "../components/ui";
import SettingsSection from "../features/settings/SettingsSection";
import { dashboardData } from "../mock/dashboard";
import { ACCOUNTING_POLICY } from "../utils/accountCalculations";
import { BRICKS_PER_MAAP, PAYABLE_BRICKS_PER_MAAP } from "../utils/labourTypes";
import { DRIVERS_LINKED_TO_LABOUR } from "../utils/truckStatus";

const yesNo = (value, yes, no) => (value ? yes : no);

/**
 * Settings.
 * The client has not confirmed any setting that needs to be editable, so nothing here can be changed.
 * This page shows the rules the app uses today and what is still waiting for an answer.
 * An editable setting is added only when the client confirms it is needed.
 */
export default function Settings() {
  const { owner } = dashboardData;

  return (
    <div className="space-y-4 sm:space-y-5">
      <div>
        <h1 className="type-page-heading">Settings</h1>
        <p className="mt-1 text-sm text-fg-muted">The rules BrickPro uses today. Nothing here is editable yet.</p>
      </div>

      <Card>
        <CardBody>
          <p className="flex items-start gap-2.5 text-sm text-fg-muted">
            <Cog className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>
              Settings are added only when the client confirms they are needed. Until then this page is read-only, so no rule can be
              changed by accident.
            </span>
          </p>
        </CardBody>
      </Card>

      <SettingsSection
        title="Account"
        icon={UserRound}
        rows={[
          { label: "Name", value: owner.fullName },
          { label: "Role", value: owner.role },
        ]}
      />

      <SettingsSection
        title="Rules in use"
        subtitle="Confirmed with the client"
        icon={ListChecks}
        rows={[
          { label: "Currency", value: "Indian rupees (₹), Indian digit grouping", status: "confirmed" },
          { label: "Dates", value: "Shown in IST", status: "confirmed" },
          { label: "Maapvali earnings", value: "Maaps / 4 x that worker's rate per 4 maaps. Every maap is paid (41 maaps at 250 per 4 = 2,562.50)", status: "confirmed" },
          { label: "Size of a maap", value: `4 maaps = ${(BRICKS_PER_MAAP * 4).toLocaleString("en-IN")} physical bricks (${BRICKS_PER_MAAP} each)`, status: "confirmed" },
          {
            label: "Patlavale payable bricks",
            value: `${PAYABLE_BRICKS_PER_MAAP} payable bricks per maap (4 maaps = 1,000). Earnings = maaps / 4 x team rate; no carry-forward`,
            status: "confirmed",
          },
          { label: "Patlavale salary", value: "Paid to the family / team, never split per member", status: "confirmed" },
          { label: "Attendance", value: "Bigari workers only", status: "confirmed" },
          { label: "Payments", value: "A money transaction only; never changes work or production records", status: "confirmed" },
        ]}
      />

      <SettingsSection
        title="Waiting for client confirmation"
        subtitle="The app uses these defaults until the client answers"
        icon={Info}
        rows={[
          {
            label: "Bayana counts as money received",
            value: yesNo(ACCOUNTING_POLICY.bayanaCountsAsReceived, "Yes (default)", "No"),
            status: "waiting",
          },
          {
            label: "Other payments reduce earnings",
            value: yesNo(ACCOUNTING_POLICY.otherCountsAsReceived, "Yes (default)", "No, shown separately"),
            status: "waiting",
          },
          { label: "Bigari half-day rule", value: "Half a day (default)", status: "waiting" },
          { label: "Season dates and closing", value: "Not set. There is no season settlement yet", status: "waiting" },
          {
            label: "Drivers linked to labour records",
            value: yesNo(DRIVERS_LINKED_TO_LABOUR, "Yes, chosen from active workers (default)", "No"),
            status: "waiting",
          },
          { label: "Maaps entered as", value: "Whole numbers of 1 or more (default)", status: "waiting" },
        ]}
      />

      <SettingsSection
        title="About"
        icon={Info}
        rows={[
          { label: "App", value: "BrickPro - Brick Business Management" },
          { label: "Version", value: "Prototype" },
          { label: "Data", value: "Sample data kept in the browser. It resets when the page is reloaded." },
        ]}
      />
    </div>
  );
}
