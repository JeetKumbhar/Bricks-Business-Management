// Static-markup tests (react-dom/server; no browser) of the Customers screen and its windows. Modal is replaced by a simple wrapper
// (the real one uses a portal). They check what is SHOWN; the save logic is covered by customerStore.test.js and customerView.test.js.
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

vi.mock("../components/ui/Modal", () => ({
  default: ({ open, title, children, footer }) => (open ? <section><h2>{title}</h2>{children}<footer>{footer}</footer></section> : null),
}));

vi.mock("../components/ui/Toast", () => ({ ToastProvider: ({ children }) => children, useToast: () => ({ success() {}, error() {}, info() {} }) }));

import { CustomerContext } from "../context/customerContextValue";
import ArchiveCustomerModal from "../features/customers/ArchiveCustomerModal";
import CustomerFormModal from "../features/customers/CustomerFormModal";
import NoCustomersNotice from "../features/trucks/NoCustomersNotice";
import { formValuesOf } from "../features/customers/customerView";
import { fromCustomerDto } from "../services/customerApi";
import Customers from "./Customers";

const c = (o) => fromCustomerDto({ id: o.name, kind: "NORMAL", isInternal: false, isArchived: false, revision: 1, ...o });
const store = (o = {}) => ({ items: [], status: "ready", loadError: "", reload: () => {}, create: async () => {}, update: async () => {}, archive: async () => {}, restore: async () => {}, enableInternal: async () => {}, getItems: () => [], ...o });
const page = (value) => renderToStaticMarkup(<MemoryRouter><CustomerContext.Provider value={value}><Customers /></CustomerContext.Provider></MemoryRouter>);

describe("Customers screen (static markup)", () => {
  it("1. shows the customers from the server with their details and Active status", () => {
    const html = page(store({ items: [c({ name: "Ram Constructions", contact: "9876543210", gstin: "27ABCDE1234F1Z5", stateName: "Maharashtra" })] }));
    for (const t of ["Ram Constructions", "9876543210", "27ABCDE1234F1Z5", "Maharashtra", "Active", "Add Customer"]) expect(html).toContain(t);
  });
  it("3. loading, empty and error states (never sample customers)", () => {
    expect(page(store({ status: "loading" }))).toContain("Loading customers");
    const empty = page(store());
    expect(empty).toContain("No customers yet");
    expect(empty).not.toMatch(/Ram|Zed|Sharma/);
    const err = page(store({ status: "error", loadError: "Server error" }));
    expect(err).toContain("Could not load the customers");
    expect(err).toContain("Server error");
    expect(err).toContain("Try again");
  });
  it("10. Internal / No Bill is shown as built-in with NO Edit or Archive button, and the 'enable' card is gone", () => {
    const html = page(store({ items: [c({ name: "Internal / No Bill", kind: "INTERNAL", isInternal: true })] }));
    expect(html).toContain("Internal / No Bill");
    expect(html).toContain("Built-in, never invoiced");
    expect(html).not.toMatch(/aria-label="(Edit|Archive|Restore) Internal/);
    expect(html).not.toContain("is not enabled");
  });
  it("10b. when Internal / No Bill does not exist, an 'Enable' action is offered", () => {
    const html = page(store({ items: [c({ name: "Ram" })] }));
    expect(html).toContain("is not enabled");
    expect(html).toContain("Enable Internal / No Bill");
  });
  it("normal active customers get Edit and Archive; archived ones are not in the Active tab", () => {
    const html = page(store({ items: [c({ name: "Ram" }), c({ name: "Old Co", isArchived: true })] }));
    expect(html).toContain('aria-label="Edit Ram"');
    expect(html).toContain('aria-label="Archive Ram"');
    expect(html).not.toContain("Old Co");
  });
});

describe("Customer windows (static markup)", () => {
  const noop = () => {};
  it("4. the add form has the backend's fields and a required name", () => {
    const html = renderToStaticMarkup(<CustomerFormModal open customer={null} onClose={noop} onSubmit={noop} />);
    for (const t of ["Add Customer", "Customer name", "Contact number", "GSTIN", "State code", "Address", "Save Customer"]) expect(html).toContain(t);
    expect(html).not.toMatch(/Internal|kind|status/i);
  });
  it("5. the edit window is titled Edit Customer and its starting values are the saved ones (missing details are empty)", () => {
    const html = renderToStaticMarkup(<CustomerFormModal open customer={c({ name: "Ram Co", contact: "98", address: "Pune" })} onClose={noop} onSubmit={noop} />);
    expect(html).toContain("Edit Customer");
    expect(html).toContain("Save Changes");
    expect(formValuesOf(c({ name: "Ram Co", contact: "98", address: "Pune" }))).toEqual({ name: "Ram Co", contact: "98", address: "Pune", gstin: "", stateName: "", stateCode: "" });
    expect(formValuesOf(null).name).toBe("");
  });
  it("5b. a revision conflict shows the server's message, keeps the entries and offers 'Load latest'", () => {
    const html = renderToStaticMarkup(<CustomerFormModal open customer={c({ name: "Ram" })} conflict="This customer was changed by someone else. Reload and try again" onClose={noop} onSubmit={noop} />);
    expect(html).toContain("Changed by someone else");
    expect(html).toContain("Nothing was overwritten");
    expect(html).toContain("Load latest");
  });
  it("a lost connection blocks Save until the list is checked", () => {
    const html = renderToStaticMarkup(<CustomerFormModal open customer={null} unconfirmed="Not confirmed whether this was saved." onClose={noop} onSubmit={noop} />);
    expect(html).toContain("Not confirmed");
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*disabled=""|<button[^>]*disabled=""[^>]*type="submit"/);
  });
  it("while saving the form is locked and says Saving...", () => {
    const html = renderToStaticMarkup(<CustomerFormModal open customer={null} submitting onClose={noop} onSubmit={noop} />);
    expect(html).toContain("Saving...");
    expect(html).toMatch(/<fieldset[^>]*disabled=""/);
  });
  it("6/7. the archive window asks for a reason, says it is not a delete, and shows the server's refusal (reason stays)", () => {
    const html = renderToStaticMarkup(<ArchiveCustomerModal customer={c({ name: "Ram" })} error="Pheera of this customer are in a draft bill. Finish or discard that draft first" onClose={noop} onSubmit={noop} />);
    expect(html).toContain("Reason");
    expect(html).toContain("You can restore it later");
    expect(html).toContain("Not archived: Pheera of this customer are in a draft bill");
    expect(renderToStaticMarkup(<ArchiveCustomerModal customer={null} onClose={noop} onSubmit={noop} />)).toBe("");
  });
});

describe("Pheera entry: no customers (static markup)", () => {
  it("100. explains that a customer must first be added in Customers, with a link", () => {
    const html = renderToStaticMarkup(<MemoryRouter><NoCustomersNotice internalAvailable={false} /></MemoryRouter>);
    expect(html).toContain("Add a customer first");
    expect(html).toContain('href="/customers"');
    expect(html).not.toContain("Until then");
  });
  it("mentions Internal / No Bill when that is the only choice", () => {
    expect(renderToStaticMarkup(<MemoryRouter><NoCustomersNotice internalAvailable /></MemoryRouter>)).toContain("only Internal / No Bill can be chosen");
  });
});
