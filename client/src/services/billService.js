// Bills data service. The rest of the app only talks to THIS file, never to the mock data directly.
//
// MOCK PHASE: everything is kept in memory in the browser (async API shape, so each body can become an HTTP call).
// Nothing here is saved to a database, and a page reload resets it. The methods take and return the SAME shapes as the
// Phase 11 backend (see features/bills/billContract.js), and follow its rules, so connecting the API later only swaps this file:
//   [API] GET   /bills, /invoice-settings          -> listBills, getSettings
//   [API] POST  /bills, PATCH /bills/:id (draft)    -> saveDraft(id | null, request)   (a draft has NO bill number)
//   [API] POST  /bills/:id/finalize                 -> finalizeBill(id, { reviewed: true, revision? })   (the number is allocated here)
//   [API] POST  /bills/:id/cancel                   -> cancelBill(id, { reason })       (finalized bills only)
//   [API] POST  /bills/:id/discard                  -> discardDraft(id, { reason? })    (drafts only)
//   [API] PATCH /invoice-settings                   -> saveSettings(request)
import { initialBills, initialInvoiceSettings } from "../mock/bills";
import { finalizeProblems, validateBillInput, validateInvoiceSettings } from "../validators/billValidator";
import { BILL_STATUS } from "../features/bills/billModel";
import { sellerSnapshot, toSettingsRequest } from "../features/bills/billContract";
import { allocateBillNumber } from "../features/bills/billNumbering";

const newId = () => `bill-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

/** Thrown when a draft is not ready to be finalized: `problems` is the backend's list of { field, message }. */
export class BillNotReadyError extends Error {
  constructor(problems) {
    super("This bill is not ready to finalize");
    this.name = "BillNotReadyError";
    this.problems = problems;
  }
}

export function createBillService(seedBills = [], seedSettings = initialInvoiceSettings) {
  let bills = structuredClone(seedBills);
  let settings = structuredClone(seedSettings);

  const find = (id) => {
    const bill = bills.find((b) => b.id === id);
    if (!bill) throw new Error("This bill no longer exists");
    return bill;
  };
  const replace = (updated) => {
    bills = bills.map((b) => (b.id === updated.id ? updated : b));
    return structuredClone(updated);
  };
  /** The request body -> the typed rows the validator reads (numbers become text, a missing number stays blank). */
  const typedRows = (items = []) => items.map((i) => ({ ...i, quantity: i.quantity ?? "", rate: i.rate ?? "", taxRate: i.taxRate ?? "" }));

  return {
    async listBills() {
      return structuredClone(bills);
    },
    async getSettings() {
      return structuredClone(settings);
    },

    /** Save the invoice settings (request = toSettingsRequest(...)). Finalized bills keep their own copy of the old details. */
    async saveSettings(request) {
      const next = { ...settings, ...request, bank: { ...settings.bank, ...request.bank }, numbering: { ...settings.numbering, ...request.numbering } };
      const check = validateInvoiceSettings(next);
      if (!check.valid) throw new Error("Some settings need attention");
      settings = { ...toSettingsRequest(next), revision: (settings.revision ?? 0) + 1 };
      return structuredClone(settings);
    },

    /**
     * Create a draft (id null) or update one. request = toBillRequest(...) = { billDate, customer, taxMode, items, notes, revision? }.
     * A draft has no bill number. It carries the CURRENT seller details only for display; they are frozen when it is finalized.
     */
    async saveDraft(id, request) {
      const existing = id ? find(id) : null;
      if (existing && existing.status !== BILL_STATUS.DRAFT) throw new Error("Only a draft can be edited");
      if (existing && request.revision !== undefined && request.revision !== existing.revision) throw new Error("This draft was changed somewhere else. Reload and try again");
      const check = validateBillInput({ ...request, items: typedRows(request.items), allowedRates: settings.allowedTaxRates });
      if (!check.valid) throw new Error("The bill is not valid. Fix the highlighted fields and try again");
      const now = new Date().toISOString();
      const bill = {
        ...(existing ?? { id: newId(), createdAt: now, isDemo: false, billNumber: null }),
        ...check.value,
        status: BILL_STATUS.DRAFT,
        seller: sellerSnapshot(settings),
        revision: (existing?.revision ?? 0) + 1,
        updatedAt: now,
      };
      bills = existing ? bills.map((b) => (b.id === id ? bill : b)) : [...bills, bill];
      return structuredClone(bill);
    },

    /**
     * Draft -> Finalized. body = { reviewed: true, revision? }. Applies the backend's readiness rules, allocates the bill number and
     * freezes the seller details used on the invoice. Throws BillNotReadyError with the list of problems.
     */
    async finalizeBill(id, body, { today }) {
      const bill = find(id);
      if (bill.status !== BILL_STATUS.DRAFT) throw new Error(`Bill ${bill.billNumber ?? ""} is already ${bill.status.toLowerCase()}`.replace("  ", " "));
      if (body?.reviewed !== true) throw new Error("Confirm that you have reviewed the bill and its tax treatment (reviewed: true)");
      if (body.revision !== undefined && body.revision !== bill.revision) throw new Error("This draft was changed somewhere else. Reload and try again");
      const seller = sellerSnapshot(settings);
      const problems = finalizeProblems(bill, seller, today);
      if (problems.length > 0) throw new BillNotReadyError(problems);
      const now = new Date().toISOString();
      return replace({ ...bill, ...allocateBillNumber(bills, settings.numbering, bill.billDate), status: BILL_STATUS.FINAL, seller, finalizedAt: now, revision: bill.revision + 1, updatedAt: now });
    },

    /** Finalized -> Cancelled, with a reason of at least 3 characters. The bill and its number stay for the record. */
    async cancelBill(id, { reason }) {
      const bill = find(id);
      if (bill.status !== BILL_STATUS.FINAL) throw new Error("Only a finalized bill can be cancelled. A draft can be discarded instead");
      const why = String(reason ?? "").trim();
      if (why.length < 3) throw new Error("Please give a reason");
      if (why.length > 200) throw new Error("Reason is too long");
      const now = new Date().toISOString();
      return replace({ ...bill, status: BILL_STATUS.CANCELLED, cancelledReason: why, cancelledAt: now, revision: bill.revision + 1, updatedAt: now });
    },

    /** A draft is thrown away (it never had a number, so no number is lost). Finalized bills cannot be discarded. */
    async discardDraft(id) {
      const bill = find(id);
      if (bill.status !== BILL_STATUS.DRAFT) throw new Error("Only a draft can be discarded. Cancel a finalized bill instead");
      bills = bills.filter((b) => b.id !== id);
    },
  };
}

/** The app-wide instance (in memory; resets when the page is reloaded). */
export const billService = createBillService(initialBills, initialInvoiceSettings);
