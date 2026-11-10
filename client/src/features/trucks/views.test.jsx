// Static-markup tests of the screens' parts (react-dom/server; no browser). Modal is replaced by a simple wrapper because the real one
// uses a portal. These check what is SHOWN: they do not click anything (the click logic is covered by the store / save-flow tests).
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../components/ui/Modal", () => ({
  default: ({ open, title, description, children, footer }) => (open ? <section><h2>{title}</h2><p>{description}</p>{children}<footer>{footer}</footer></section> : null),
}));

import PheeraRowEditor from "./PheeraRowEditor";
import PheeraTable from "./PheeraTable";
import StatusChangeModal from "./StatusChangeModal";
import TruckCard from "./TruckCard";
import TruckDetailsModal from "./TruckDetailsModal";
import TruckFormModal from "./TruckFormModal";

const render = (el) => renderToStaticMarkup(<MemoryRouter>{el}</MemoryRouter>);
const row = (o = {}) => ({ id: "p1", businessDate: "2026-11-01", registration: "MH12AB1234", truckRegistration: "MH12AB1234", pheeraNumber: 3, material: "Bricks", unit: "bricks", destination: "Pune", quantity: 1500, remarks: "", customerName: "Ram", billingStatus: "UNBILLED", ...o });
const truck = (o = {}) => ({ id: "t1", truckNumber: "MH12AB1234", nickname: "", model: "Tata", capacity: 4, driverId: null, driverName: null, status: "WORKING", statusSince: "2026-11-01", stopReason: null, statusNote: "", ...o });

describe("Pheera list (static markup)", () => {
  it("6. shows the server's Pheera number, truck, date, material, destination, quantity and customer", () => {
    const html = render(<PheeraTable rows={[row()]} />);
    for (const text of ["#3", "MH12AB1234", "Bricks", "Pune", "1,500 bricks", "Ram", "Not billed"]) expect(html).toContain(text);
  });

  it("7. a historical Pheera (no customer, no billing status, empty remarks) renders safely and says so", () => {
    const html = render(<PheeraTable rows={[row({ customerName: null, billingStatus: null, remarks: "" })]} />);
    expect(html).toContain("No customer");
    expect(html).toContain("Older record");
    expect(html).not.toContain("undefined");
    expect(html).not.toContain("null");
  });

  it("billing statuses use clear labels", () => {
    const html = render(<PheeraTable rows={[row({ id: "a", billingStatus: "RESERVED" }), row({ id: "b", billingStatus: "BILLED" }), row({ id: "c", billingStatus: "NOT_BILLABLE", customerName: "Internal / No Bill" })]} />);
    for (const text of ["In draft bill", "Billed", "No bill (internal)"]) expect(html).toContain(text);
  });

  it("a reserved or billed Pheera cannot be deleted from the list (the server also refuses it); others can", () => {
    const html = render(<PheeraTable rows={[row({ id: "a", billingStatus: "BILLED" })]} onDelete={() => {}} />);
    expect(html).toContain('disabled=""');
    expect(html).toContain("Locked: this Pheera is in a bill");
    const open = render(<PheeraTable rows={[row({ id: "a", billingStatus: "UNBILLED" })]} onDelete={() => {}} />);
    expect(open).not.toContain('disabled=""');
  });
});

describe("Pheera entry row (static markup)", () => {
  const options = [{ value: "c1", label: "Ram" }, { value: "i1", label: "Internal / No Bill (not invoiced)" }];
  const draft = (o = {}) => ({ key: "k", customerId: "", material: "", customMaterial: "", destination: "", quantity: "", remarks: "", ...o });

  it("10. asks for a customer and offers Internal / No Bill as its own labelled choice", () => {
    const html = render(<PheeraRowEditor title="Pheera 1" draft={draft()} customerOptions={options} onChange={() => {}} onRemove={() => {}} />);
    expect(html).toContain("Customer");
    expect(html).toContain("Ram");
    expect(html).toContain("Internal / No Bill (not invoiced)");
  });

  it("9. bricks ask for a whole number; other materials ask for tonnes; Other asks for the material name", () => {
    const bricks = render(<PheeraRowEditor title="P" draft={draft({ material: "Bricks" })} customerOptions={options} onChange={() => {}} onRemove={() => {}} />);
    expect(bricks).toContain("Number of Bricks");
    expect(bricks).toContain("Whole numbers only");
    const soil = render(<PheeraRowEditor title="P" draft={draft({ material: "Soil" })} customerOptions={options} onChange={() => {}} onRemove={() => {}} />);
    expect(soil).toContain("Weight (Tonnes)");
    const other = render(<PheeraRowEditor title="P" draft={draft({ material: "Other" })} customerOptions={options} onChange={() => {}} onRemove={() => {}} />);
    expect(other).toContain("Material Type");
  });

  it("the server's refusal is shown on the row's customer field", () => {
    const html = render(<PheeraRowEditor title="P" draft={draft({ customerId: "c1" })} customerOptions={options} errors={{ customerId: 'Customer "Ram" is archived' }} onChange={() => {}} onRemove={() => {}} />);
    expect(html).toContain("is archived");
  });

  it("there is no field for the Pheera number or the unit (the server owns them)", () => {
    const html = render(<PheeraRowEditor title="Pheera 1" draft={draft({ material: "Bricks" })} customerOptions={options} onChange={() => {}} onRemove={() => {}} />);
    expect(html).not.toMatch(/Pheera (No|Number)|>Unit</i);
  });
});

describe("Truck screens (static markup)", () => {
  it("5. the truck card still shows status and the stop reason", () => {
    const html = render(<TruckCard truck={truck({ status: "STOPPED", stopReason: "BREAKDOWN", statusNote: "Gearbox" })} onUpdateStatus={() => {}} onDetails={() => {}} onEdit={() => {}} />);
    expect(html).toContain("Stopped since");
    expect(html).toContain("Breakdown");
    expect(html).toContain("Gearbox");
  });

  it("5. the status form has NO cost field, and says maintenance cost cannot be saved", () => {
    const stopped = render(<StatusChangeModal truck={truck({ status: "MAINTENANCE" })} onClose={() => {}} onSubmit={() => {}} />);
    expect(stopped).not.toMatch(/cost/i); // leaving maintenance used to ask for a "final maintenance cost"
    // a Working truck's first choice is Stopped: reason + note, still no cost
    const working = render(<StatusChangeModal truck={truck()} onClose={() => {}} onSubmit={() => {}} />);
    expect(working).toContain("Why did it stop?");
    expect(working).not.toMatch(/cost/i);
  });

  it("5. the history window shows server history and a 'Not available yet' maintenance note, with no way to add a service record", () => {
    const history = { status: "ready", error: "", items: [{ id: "h1", kind: "STATUS", from: "WORKING", to: "STOPPED", reason: "BREAKDOWN", note: "Gearbox", changedBy: "Ramesh", changedAt: "2026-11-01T10:00:00Z" }] };
    const html = render(<TruckDetailsModal truck={truck()} history={history} onRetry={() => {}} onClose={() => {}} />);
    expect(html).toContain("Working to Stopped (Breakdown)");
    expect(html).toContain("Ramesh");
    expect(html).toContain("Not available yet");
    expect(html).not.toContain("Add service record");
  });

  it("the history window shows loading, errors with a retry button, and an empty history", () => {
    expect(render(<TruckDetailsModal truck={truck()} history={{ status: "loading", items: [], error: "" }} onRetry={() => {}} onClose={() => {}} />)).toContain("Loading history");
    const err = render(<TruckDetailsModal truck={truck()} history={{ status: "error", items: [], error: "Server error" }} onRetry={() => {}} onClose={() => {}} />);
    expect(err).toContain("Server error");
    expect(err).toContain("Try again");
    expect(render(<TruckDetailsModal truck={truck()} history={{ status: "ready", items: [], error: "" }} onRetry={() => {}} onClose={() => {}} />)).toContain("No history recorded");
  });

  it("13. while a save runs the truck form is locked and says Saving...", () => {
    const html = render(<TruckFormModal open truck={null} drivers={[]} allLabours={[]} isTruckNumberTaken={() => false} submitting onClose={() => {}} onSubmit={() => {}} />);
    expect(html).toContain("Saving...");
    expect(html).toMatch(/<fieldset[^>]*disabled=""/);
    const idle = render(<TruckFormModal open truck={null} drivers={[]} allLabours={[]} isTruckNumberTaken={() => false} onClose={() => {}} onSubmit={() => {}} />);
    expect(idle).toContain("Save Truck");
    expect(idle).not.toMatch(/<fieldset[^>]*disabled=""/);
  });
});

describe("Truck windows with an unconfirmed save (static markup)", () => {
  const msg = 'The connection was lost, so it is not confirmed whether this was saved. Do not save it again yet: press "Check again".';
  it("the form shows the notice, a Check again button, and blocks Save and the fields", () => {
    const html = render(<TruckFormModal open truck={null} drivers={[]} allLabours={[]} isTruckNumberTaken={() => false} unconfirmed={msg} onRecheck={() => {}} onClose={() => {}} onSubmit={() => {}} />);
    expect(html).toContain("Not confirmed");
    expect(html).toContain("Check again");
    expect(html).toMatch(/<fieldset[^>]*disabled=""/);
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*disabled=""|<button[^>]*disabled=""[^>]*type="submit"/);
  });
  it("the status window shows the same notice and blocks Save", () => {
    const html = render(<StatusChangeModal truck={truck()} unconfirmed={msg} onRecheck={() => {}} onClose={() => {}} onSubmit={() => {}} />);
    expect(html).toContain("Not confirmed");
    expect(html).toContain("Check again");
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*disabled=""|<button[^>]*disabled=""[^>]*type="submit"/);
  });
  it("without an unconfirmed save there is no notice and Save is available", () => {
    const html = render(<StatusChangeModal truck={truck()} onClose={() => {}} onSubmit={() => {}} />);
    expect(html).not.toContain("Not confirmed");
    expect(html).not.toMatch(/<button[^>]*type="submit"[^>]*disabled=""|<button[^>]*disabled=""[^>]*type="submit"/);
  });
});
