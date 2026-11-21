// MOCKED / static-markup tests: no real server or database.
// A worker's mobile number is optional and may be shared with another worker.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { initialLabours } from "../../mock/labours";
import { toCreateLabourBody, toUpdateLabourBody } from "../../services/labourApi";
import { mobileText, normalizeMobile } from "../../utils/mobile";
import { labourSchema } from "../../validators/labourValidator";
import { labourRecordSchema } from "../../validators/labourRecordValidator";
import LabourCard from "./LabourCard";
import LabourForm from "./LabourForm";
import LabourTable from "./LabourTable";
import { filterLabours } from "./labourSelectors";
import { toFormValues } from "./labourRecord";
import ProfileHeader from "./profile/ProfileHeader";

vi.mock("../../components/ui/Dropdown", () => ({ default: () => null }));

const form = (o = {}) => ({ labourType: "BIGARI", name: "Ramesh Kumar", mobile: "", village: "Sinnar", joiningDate: "2026-04-01", rate: "650", status: "ACTIVE", ...o });
const base = initialLabours.find((l) => l.labourType === "BIGARI");
const noPhone = { ...base, mobile: null };

describe("the form accepts no mobile number, and a valid one, but not a bad one", () => {
  it("empty, blank and omitted are fine", () => {
    expect(labourSchema.safeParse(form({ mobile: "" })).success).toBe(true);
    expect(labourSchema.safeParse(form({ mobile: "   " })).success).toBe(true);
  });
  it("a valid 10-digit number is fine, an invalid one is refused with the same message as before", () => {
    expect(labourSchema.safeParse(form({ mobile: "9876543210" })).success).toBe(true);
    for (const mobile of ["12345", "5876543210", "98765432101", "98765 43210"]) {
      const r = labourSchema.safeParse(form({ mobile }));
      expect(r.success, mobile).toBe(false);
      expect(r.error.issues[0].message).toBe("Enter a valid 10-digit mobile number");
    }
  });
  it("every category works without a number", () => {
    for (const labourType of ["BIGARI", "MAAPVALI", "PATLAVALE"]) expect(labourSchema.safeParse(form({ labourType, mobile: "" })).success, labourType).toBe(true);
  });
  it("a stored record may have no number (null or missing)", () => {
    const record = { id: "L-001", labourType: "BIGARI", name: "Ramesh", village: "Sinnar", status: "ACTIVE", joiningDate: "2026-01-01", dailyRate: 650 };
    expect(labourRecordSchema.safeParse({ ...record, mobile: null }).success).toBe(true);
    expect(labourRecordSchema.safeParse(record).success).toBe(true);
    expect(labourRecordSchema.safeParse({ ...record, mobile: "9876543210" }).success).toBe(true);
    expect(labourRecordSchema.safeParse({ ...record, mobile: "123" }).success).toBe(false);
  });
});

describe("the Add form no longer asks for the number or checks for duplicates", () => {
  const html = renderToStaticMarkup(<LabourForm formId="f" mode="add" defaultValues={form()} onSubmit={() => {}} />);
  it("the mobile field is labelled optional and is not required", () => {
    expect(html).toContain("Mobile (optional)");
    const field = /<input[^>]*inputMode="numeric"[^>]*>/.exec(html)?.[0] ?? "";
    expect(field).not.toMatch(/aria-required/);
    expect(html).toContain("The same number can be used for more than one worker");
  });
  it("the form works without an isMobileTaken function", () => {
    expect(() => renderToStaticMarkup(<LabourForm formId="f" mode="edit" defaultValues={toFormValues(noPhone)} labourId="L-001" onSubmit={() => {}} />)).not.toThrow();
  });
});

describe("what is sent to the server", () => {
  it("create: an empty number is sent as null, a given one is trimmed", () => {
    expect(toCreateLabourBody({ ...form({ mobile: "" }), dailyRate: 650 }).mobile).toBeNull();
    expect(toCreateLabourBody({ ...form({ mobile: " 9876543210 " }), dailyRate: 650 }).mobile).toBe("9876543210");
  });
  it("edit: clearing sends null; unchanged or still-empty is not sent; changing sends the new number", () => {
    const has = { name: "A", mobile: "9876543210", village: "V", joiningDate: "2026-01-01", status: "ACTIVE" };
    expect(toUpdateLabourBody(has, { mobile: "" })).toEqual({ mobile: null });
    expect(toUpdateLabourBody(has, { mobile: "9876543210" })).toEqual({});
    expect(toUpdateLabourBody(has, { mobile: "9000000000" })).toEqual({ mobile: "9000000000" });
    expect(toUpdateLabourBody({ ...has, mobile: null }, { mobile: "" })).toEqual({});
    expect(toUpdateLabourBody({ ...has, mobile: null }, { mobile: "9000000000" })).toEqual({ mobile: "9000000000" });
  });
  it("the edit form starts with an empty field for a worker with no number", () => {
    expect(toFormValues(noPhone).mobile).toBe("");
  });
  it("helpers", () => {
    expect([normalizeMobile(null), normalizeMobile(undefined), normalizeMobile("  "), normalizeMobile(" 98 ")]).toEqual([null, null, null, "98"]);
    expect([mobileText(null), mobileText(""), mobileText("9876543210")]).toEqual(["-", "-", "9876543210"]);
  });
});

describe("workers with no number display and search without errors", () => {
  it("search by name, id and number still works with a null number among the workers", () => {
    const list = [noPhone, { ...initialLabours.find((l) => l.labourType === "MAAPVALI"), mobile: "9000012345" }];
    expect(() => filterLabours(list, { search: "9000012345" })).not.toThrow();
    expect(filterLabours(list, { search: "9000012345" })).toHaveLength(1);
    expect(filterLabours(list, { search: noPhone.name.slice(0, 4) }).some((l) => l.id === noPhone.id)).toBe(true);
  });
  it("two workers may share a number: both are found", () => {
    const a = { ...base, id: "L-901", mobile: "9000012345" };
    const b = { ...base, id: "L-902", mobile: "9000012345", name: "Other Person" };
    expect(filterLabours([a, b], { search: "9000012345" }).map((l) => l.id)).toEqual(["L-901", "L-902"]);
  });
  it("the card shows 'Not given' and no call link", () => {
    const html = renderToStaticMarkup(<ul><LabourCard labour={noPhone} onView={() => {}} onEdit={() => {}} onToggleStatus={() => {}} /></ul>);
    expect(html).toContain("Not given");
    expect(html).not.toContain("tel:");
  });
  it("the card still shows a call link when there is a number", () => {
    const html = renderToStaticMarkup(<ul><LabourCard labour={{ ...base, mobile: "9876543210" }} onView={() => {}} onEdit={() => {}} onToggleStatus={() => {}} /></ul>);
    expect(html).toContain("tel:9876543210");
  });
  it("the profile header has no Call button without a number, and has one with a number", () => {
    const html = (l) => renderToStaticMarkup(<ProfileHeader labour={l} onEdit={() => {}} onToggleStatus={() => {}} />);
    expect(html(noPhone)).not.toContain("tel:");
    expect(html({ ...base, mobile: "9876543210" })).toContain("tel:9876543210");
  });
  it("the table shows a dash", () => {
    const html = renderToStaticMarkup(<LabourTable labours={[noPhone]} onView={() => {}} onEdit={() => {}} onToggleStatus={() => {}} />);
    expect(html).not.toContain(">null<");
    expect(html).toContain("-");
  });
});
