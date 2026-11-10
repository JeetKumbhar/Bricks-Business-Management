// What the Customers screen shows and allows (pure functions). The server stays the authority: these only decide which buttons are offered.
export const INTERNAL_NAME = "Internal / No Bill";

/** "internal" (the built-in customer), "archived" or "active". */
export const customerState = (c) => (c.isInternal ? "internal" : c.isArchived ? "archived" : "active");

// The built-in Internal / No Bill customer can never be edited, archived or duplicated.
export const canEdit = (c) => !c.isInternal && !c.isArchived;
export const canArchive = (c) => !c.isInternal && !c.isArchived;
export const canRestore = (c) => !c.isInternal && c.isArchived;

const norm = (v) => String(v ?? "").replace(/\s+/g, " ").trim().toLowerCase();

/** view: "active" (active customers + the built-in one) | "archived". query: matches name, contact, GSTIN, state and address (case and extra spaces ignored). Built-in first, then A-Z. */
export function filterCustomers(items, { query = "", view = "active" } = {}) {
  const q = norm(query);
  return items
    .filter((c) => (view === "archived" ? c.isArchived && !c.isInternal : !c.isArchived))
    .filter((c) => !q || [c.name, c.contact, c.gstin, c.stateName, c.address].some((f) => norm(f).includes(q)))
    .sort((a, b) => Number(b.isInternal) - Number(a.isInternal) || a.name.localeCompare(b.name));
}

export const countByView = (items) => ({
  active: items.filter((c) => !c.isArchived && !c.isInternal).length,
  archived: items.filter((c) => c.isArchived && !c.isInternal).length,
});

/** Archiving needs a reason (the server also requires 3 to 200 characters). -> an error message, or "" when it is fine. */
export const validateArchiveReason = (reason) => {
  const r = String(reason ?? "").trim();
  if (r.length < 3) return "Please give a reason (at least 3 characters)";
  if (r.length > 200) return "The reason is too long (200 characters at most)";
  return "";
};

/** The form's starting values for a customer (null = a new one). Missing details are empty text. */
export const formValuesOf = (c) => ({ name: c?.name ?? "", contact: c?.contact ?? "", address: c?.address ?? "", gstin: c?.gstin ?? "", stateName: c?.stateName ?? "", stateCode: c?.stateCode ?? "" });
