import { useMemo } from "react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { Card, CardBody } from "../../components/ui";
import { formatCurrency } from "../../utils/formatCurrency";
import useLabours from "../labours/useLabours";
import { reconcileBalances } from "./reconcile";

/**
 * The Salary figures above are calculated by the server. This checks them against the figures the other screens work out
 * from the loaded records (Payments, profiles, Dashboard). If any differ, it says which, instead of hiding it.
 */
export default function SalaryReconciliation({ serverRows }) {
  const { allLabours } = useLabours();
  const result = useMemo(() => reconcileBalances(serverRows, allLabours), [serverRows, allLabours]);

  if (result.differences.length === 0) {
    return (
      <p className="flex items-center gap-2 text-xs text-fg-muted">
        <CheckCircle2 className="h-4 w-4 shrink-0 text-success" aria-hidden="true" />
        Checked: the server's season-to-date earned, received and balance match the rest of the app for all {result.checked} {result.checked === 1 ? "account" : "accounts"}.
      </p>
    );
  }

  return (
    <Card>
      <CardBody>
        <p className="flex items-start gap-2 text-sm font-semibold text-danger">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          The server's figures differ from the rest of the app for {new Set(result.differences.map((d) => d.id)).size} account(s)
        </p>
        <p className="mt-1 text-sm text-fg-muted">The Salary figures above are the server's. Please check these accounts before paying from any other screen.</p>
        <ul className="mt-3 space-y-1 text-sm">
          {result.differences.map((d) => (
            <li key={`${d.id}-${d.field}`}>
              <span className="font-medium">{d.name}</span> ({d.id}), {d.field}: server {formatCurrency(d.server)}, app {d.app === null ? "none" : formatCurrency(d.app)}
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}
