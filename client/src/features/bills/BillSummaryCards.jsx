import { Ban, CheckCircle2, FileText, IndianRupee, Pencil } from "lucide-react";
import { StatCard } from "../../components/ui";
import { formatRupees } from "../../utils/money";

/**
 * Dashboard numbers for the Bills page. "Total Invoiced" adds up FINALIZED bills only: drafts are not sales yet and
 * cancelled bills are not sales, so neither is included.
 */
export default function BillSummaryCards({ summary }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4 [&>*]:min-w-0">
      <StatCard title="Total Bills" value={summary.total} icon={FileText} color="blue" variant="soft" />
      <StatCard title="Draft Bills" value={summary.draft} icon={Pencil} color="yellow" variant="soft" caption="Not counted as sales" />
      <StatCard title="Finalized Bills" value={summary.finalized} icon={CheckCircle2} color="green" variant="soft" />
      <StatCard title="Cancelled Bills" value={summary.cancelled} icon={Ban} color="red" variant="soft" caption="Not counted as sales" />
      <StatCard
        title="Total Invoiced"
        value={formatRupees(summary.invoicedPaise)}
        icon={IndianRupee}
        color="purple"
        variant="soft"
        caption="Finalized bills only"
        className="col-span-2 lg:col-span-4 [&_p.truncate]:text-xl sm:[&_p.truncate]:text-2xl"
      />
    </div>
  );
}
