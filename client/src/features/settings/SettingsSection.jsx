import { Badge, Card, CardBody, CardHeader } from "../../components/ui";

/**
 * A read-only block of settings. status: "confirmed" | "waiting" (optional badge on each row).
 * rows: [{ label, value, status? }]
 */
export default function SettingsSection({ title, subtitle, icon, rows }) {
  return (
    <Card>
      <CardHeader title={title} subtitle={subtitle} icon={icon} />
      <CardBody>
        <dl className="divide-y divide-border text-sm">
          {rows.map((row) => (
            <div key={row.label} className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
              <dt className="text-fg-muted sm:max-w-[45%]">{row.label}</dt>
              <dd className="flex flex-wrap items-center gap-2 font-medium sm:justify-end sm:text-right">
                <span>{row.value}</span>
                {row.status === "confirmed" && (
                  <Badge variant="success" size="sm">
                    Confirmed
                  </Badge>
                )}
                {row.status === "waiting" && (
                  <Badge variant="warning" size="sm">
                    Waiting for client
                  </Badge>
                )}
              </dd>
            </div>
          ))}
        </dl>
      </CardBody>
    </Card>
  );
}
