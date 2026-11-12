import { useNavigate, Link } from "react-router-dom";
import { ArrowLeft, FilePlus2 } from "lucide-react";
import { Button, Card, CardBody, CardHeader, LoadingState, Select, useToast } from "../components/ui";
import useCustomerChoices from "../features/customers/useCustomerChoices";
import PheeraPicker from "../features/bills/PheeraPicker";
import useBillFromPheeras from "../features/bills/useBillFromPheeras";
import { useBills } from "../context/BillContext";
import { useTruckTripStore } from "../context/TruckTripContext";
import { formatQuantity, UNITS } from "../utils/materials";

/**
 * Make a DRAFT bill from unbilled Pheeras of ONE customer. The server decides what is eligible and creates one bill line per Pheera;
 * the rate, HSN and tax rate are filled in afterwards on the draft. After a created draft the screen opens it (server data).
 */
export default function BillFromPheeras() {
  const navigate = useNavigate();
  const toast = useToast();
  const choices = useCustomerChoices();
  const { reload: reloadBills } = useBills();
  const { reload: reloadPheeras } = useTruckTripStore();

  const flow = useBillFromPheeras({
    onCreated: (billId, result) => {
      reloadBills(); // the new draft is in the list
      reloadPheeras(); // the Pheeras now show "In draft bill"
      toast.success(result?.duplicate ? "This draft bill was already created" : "Draft bill created. Now enter the rate, HSN and tax rate");
      navigate(`/bills/${billId}`);
    },
  });
  const { outcome } = flow;

  if (choices.loading) return <LoadingState />;
  const options = choices.customers.map((c) => ({ value: c.id, label: c.name }));

  return (
    <div className="space-y-4 sm:space-y-5">
      <div>
        <Link to="/bills" className="mb-1 inline-flex items-center gap-1.5 py-1 text-sm font-medium text-primary">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Bills
        </Link>
        <h1 className="type-page-heading">Bill from Pheeras</h1>
        <p className="mt-1 text-sm text-fg-muted">Choose a customer, tick their unbilled Pheeras and create a draft bill. Each Pheera becomes its own line.</p>
      </div>

      {choices.error && <p role="alert" className="rounded-lg bg-danger-soft px-4 py-3 text-sm text-danger">Could not load customers: {choices.error}</p>}

      <Card>
        <CardBody>
          <Select label="Customer" required placeholder="Choose a customer" value={flow.customerId} onChange={(e) => flow.chooseCustomer(e.target.value)} options={options} disabled={flow.busy} hint="Internal / No Bill Pheeras are never invoiced, and one bill is for one customer." />
        </CardBody>
      </Card>

      {flow.customerId && (
        <Card>
          <CardHeader title="Unbilled Pheeras" subtitle="Only Pheeras the server says can be billed are listed" />
          <CardBody className="space-y-4">
            {flow.loadError && (
              <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-danger-soft px-4 py-3 text-sm text-danger">
                <span>{flow.loadError}</span>
                <Button variant="outline" size="sm" onClick={flow.reload}>Try again</Button>
              </div>
            )}
            {flow.loading ? <p className="text-sm text-fg-muted" aria-live="polite">Loading Pheeras...</p> : <PheeraPicker rows={flow.rows} selected={flow.selected} onToggle={flow.toggle} onToggleAll={flow.toggleAll} disabled={flow.locked} />}
          </CardBody>
        </Card>
      )}

      {outcome && outcome.kind !== "created" && <OutcomeNotice outcome={outcome} busy={flow.busy} onRecheck={flow.recheck} onRetry={flow.submit} />}
      {flow.problem && <p role="alert" className="text-sm text-danger">{flow.problem}</p>}

      {flow.customerId && (
        <Card>
          <CardBody className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm" aria-live="polite">
              <strong>{flow.summary.count}</strong> selected
              {flow.summary.bricks > 0 && <> - {formatQuantity(flow.summary.bricks, UNITS.BRICKS)} bricks</>}
              {flow.summary.tonnes > 0 && <> - {formatQuantity(flow.summary.tonnes, UNITS.TONNES)} tonnes</>}
            </p>
            <Button leftIcon={FilePlus2} onClick={flow.submit} loading={flow.busy} disabled={flow.locked || flow.selected.length === 0}>
              Create draft bill
            </Button>
          </CardBody>
        </Card>
      )}
    </div>
  );
}

function OutcomeNotice({ outcome, busy, onRecheck, onRetry }) {
  if (outcome.kind === "refused") {
    return (
      <div role="alert" className="space-y-1 rounded-lg bg-danger-soft px-4 py-3 text-sm text-danger">
        <p className="font-medium">Nothing was created. {outcome.message}</p>
        {outcome.problems.map((p) => <p key={p}>{p}</p>)}
      </div>
    );
  }
  if (outcome.kind === "not_applied") {
    return (
      <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-warning-soft px-4 py-3 text-sm text-amber-700">
        <span>{outcome.message} The server shows nothing was created. It is safe to try again.</span>
        <Button variant="outline" size="sm" onClick={onRetry} loading={busy}>Create draft bill again</Button>
      </div>
    );
  }
  return (
    <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-warning-soft px-4 py-3 text-sm text-amber-700">
      <span>Not confirmed: the connection was lost and the result could not be checked. {outcome.why} Do not create it again until this is settled.</span>
      <Button variant="outline" size="sm" onClick={onRecheck} loading={busy}>Check again</Button>
    </div>
  );
}
