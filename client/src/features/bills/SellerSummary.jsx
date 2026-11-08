import { useNavigate } from "react-router-dom";
import { Building2, Pencil } from "lucide-react";
import { Button, Card, CardBody, CardHeader } from "../../components/ui";

/**
 * Seller + bank details on the bill form. They come from Settings (one place) and cannot be typed here.
 * Collapsed by default; "Edit Business Details" opens that Settings section.
 */
export default function SellerSummary({ settings }) {
  const navigate = useNavigate();
  const bank = settings.bank ?? {};
  const rows = [
    ["Business", [settings.businessName, settings.businessDescription].filter(Boolean).join(" - ")],
    ["Address", settings.address],
    ["Phone", (settings.phones ?? []).join(", ")],
    ["GSTIN / PAN", [settings.gstin, settings.pan].filter(Boolean).join(" / ")],
    ["State / code", [settings.stateName, settings.stateCode].filter(Boolean).join(" / ")],
    ["Jurisdiction", settings.jurisdiction],
    ["Bank", [bank.bankName, bank.branch].filter(Boolean).join(", ")],
    ["Account / IFSC", [bank.accountNumber, bank.ifsc].filter(Boolean).join(" / ")],
  ];
  return (
    <Card>
      <CardHeader
        title="Seller Details"
        subtitle="Filled from Invoice Settings. Printed on every bill."
        icon={Building2}
        action={
          <Button variant="outline" size="sm" leftIcon={Pencil} onClick={() => navigate("/settings#invoice-settings")}>
            Edit Business Details
          </Button>
        }
      />
      <CardBody>
        <p className="text-sm font-medium">
          {settings.businessName} <span className="font-normal text-fg-muted">{settings.gstin ? `- GSTIN ${settings.gstin}` : "- GSTIN not added yet"}</span>
        </p>
        <details className="group mt-2 text-sm">
          <summary className="cursor-pointer select-none py-1 text-primary">Show all seller and bank details</summary>
          <dl className="mt-2 divide-y divide-border">
            {rows.map(([label, value]) => (
              <div key={label} className="flex flex-col gap-0.5 py-2 sm:flex-row sm:gap-4">
                <dt className="text-fg-muted sm:w-36 sm:shrink-0">{label}</dt>
                <dd className="font-medium">{value || <span className="font-normal text-fg-muted">Not added yet</span>}</dd>
              </div>
            ))}
          </dl>
        </details>
      </CardBody>
    </Card>
  );
}
