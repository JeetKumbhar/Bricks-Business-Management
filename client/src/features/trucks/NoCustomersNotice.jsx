import { Link } from "react-router-dom";

/** Shown in the Pheera entry when there is no normal customer to choose: a customer must first be added in Customers. */
export default function NoCustomersNotice({ internalAvailable }) {
  return (
    <p role="status" className="rounded-lg bg-warning-soft px-3 py-2 text-sm text-amber-700">
      There are no customers yet. Add a customer first in{" "}
      <Link to="/customers" className="font-semibold underline">
        Customers
      </Link>
      ; every billable Pheera needs one.
      {internalAvailable ? " Until then only Internal / No Bill can be chosen." : ""}
    </p>
  );
}
