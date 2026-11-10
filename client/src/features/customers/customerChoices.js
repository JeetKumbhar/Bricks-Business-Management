// Which customers a new Pheera may be given (pure functions). Internal / No Bill is the business's own, never-invoiced customer:
// it is offered as its own choice and is NEVER part of the normal customer list. Archived customers are never offered.
import { isSelectableForSale } from "../../services/customerApi";

export const INTERNAL_LABEL = "Internal / No Bill (not invoiced)";

/** all = customers read from the server -> { customers (active, normal, A-Z), internal (the built-in one, or null) }. */
export const splitCustomers = (all) => ({
  customers: all.filter(isSelectableForSale).sort((a, b) => a.name.localeCompare(b.name)),
  internal: all.find((c) => c.isInternal && !c.isArchived) ?? null,
});

/** -> [{ value: customerId, label }] for the customer dropdown of a Pheera row. */
export const customerOptionsFor = ({ customers, internal }) => [
  ...customers.map((c) => ({ value: c.id, label: c.name })),
  ...(internal ? [{ value: internal.id, label: INTERNAL_LABEL }] : []),
];
