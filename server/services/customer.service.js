import { CUSTOMER_HISTORY, CUSTOMER_KIND, INTERNAL_CUSTOMER_NAME } from "../constants/customer.js";
import { BILLING_STATUS } from "../constants/billing.js";
import Customer from "../models/Customer.js";
import TruckTrip from "../models/TruckTrip.js";
import ApiError from "../utils/ApiError.js";
import { runInTransaction } from "../utils/transaction.js";
import { escapeRegExp, normalizeText, textKey } from "../utils/truckRules.js";

// Customers. Rules:
//  - A name is unique ignoring case and extra spaces, across ALL records. An archived (soft-deleted) name is NOT reused silently and
//    NOT reactivated silently: creating a customer with an archived customer's name is refused with a message naming that record;
//    reactivating is the separate, explicit "restore".
//  - The built-in "Internal / No Bill" customer is created only on request (ensureInternalCustomer). It cannot be edited, archived
//    or duplicated, and it is never usable on an invoice (enforced in the bill and Pheera services).
//  - Nothing is ever erased. Bills keep their own frozen copy of the customer, so editing or archiving a customer changes no invoice.
export const INTERNAL_KEY = textKey(INTERNAL_CUSTOMER_NAME);
const actorOf = (actor) => ({ id: actor.id ?? null, name: actor.name ?? "Unknown" });
const historyRow = (action, actor, revision, reason = null) => ({ action, at: new Date(), by: actorOf(actor).name, byId: actorOf(actor).id, reason, revision });
const isDuplicateKey = (err) => err?.code === 11000;

export const toCustomerDto = (c) => ({
  id: String(c.id ?? c._id), name: c.name, kind: c.kind ?? CUSTOMER_KIND.NORMAL, isInternal: c.kind === CUSTOMER_KIND.INTERNAL, address: c.address ?? "", gstin: c.gstin ?? "", stateName: c.stateName ?? "", stateCode: c.stateCode ?? "", contact: c.contact ?? "",
  isArchived: Boolean(c.isDeleted), archivedAt: c.isDeleted ? c.deletedAt : null, archivedBy: c.isDeleted ? c.deletedBy : null, archivedReason: c.isDeleted ? c.deletedReason : null,
  revision: c.revision ?? 1, createdAt: c.createdAt, updatedAt: c.updatedAt, history: c.history ?? [],
});

/** The fields copied onto a bill as its customer snapshot. */
export const customerSnapshot = (c) => ({ name: c.name, address: c.address ?? "", gstin: c.gstin ?? "", stateName: c.stateName ?? "", stateCode: c.stateCode ?? "", contact: c.contact ?? "" });

export const loadCustomer = async (id) => {
  const [row] = await Customer.find({ _id: id }).lean();
  if (!row) throw ApiError.notFound("Customer not found");
  return row;
};

const nameClash = async (name, exceptId = null) => {
  const [hit] = await Customer.find({ customerKey: textKey(name) }).lean();
  if (!hit || String(hit._id) === String(exceptId)) return;
  const message = hit.isDeleted
    ? `A customer named "${hit.name}" already exists but is archived. Restore it (POST /api/customers/${hit._id}/restore) instead of creating a duplicate`
    : `A customer named "${hit.name}" already exists`;
  throw ApiError.conflict(message, [{ field: "name", message }]);
};

const refuseInternal = (c, what) => {
  if (c.kind === CUSTOMER_KIND.INTERNAL) throw ApiError.conflict(`"${INTERNAL_CUSTOMER_NAME}" is a built-in customer and cannot be ${what}`);
};

export const listCustomers = async ({ search, kind, includeArchived = false, page = 1, limit = 100 }) => {
  const filter = { ...(includeArchived ? {} : { isDeleted: { $ne: true } }), ...(kind ? { kind } : {}) };
  const term = search?.trim();
  if (term) filter.customerKey = new RegExp(escapeRegExp(textKey(term)));
  const [rows, total] = await Promise.all([Customer.find(filter).sort({ customerKey: 1 }).skip((page - 1) * limit).limit(limit).lean(), Customer.countDocuments(filter)]);
  return { items: rows.map(toCustomerDto), meta: { page, limit, total } };
};

export const getCustomer = async (id) => toCustomerDto(await loadCustomer(id));

export const createCustomer = async (body, actor) => {
  const name = normalizeText(body.name);
  if (textKey(name) === INTERNAL_KEY) throw ApiError.conflict(`"${INTERNAL_CUSTOMER_NAME}" is reserved for the built-in internal customer`, [{ field: "name", message: "This name is reserved" }]);
  await nameClash(name);
  try {
    const [created] = await Customer.insertMany([
      { name, customerKey: textKey(name), kind: CUSTOMER_KIND.NORMAL, address: body.address ?? "", gstin: body.gstin ?? "", stateName: body.stateName ?? "", stateCode: body.stateCode ?? "", contact: body.contact ?? "", revision: 1, history: [historyRow(CUSTOMER_HISTORY.CREATE, actor, 1)], isDeleted: false, createdBy: actorOf(actor).id, createdByName: actorOf(actor).name, updatedBy: actorOf(actor).id, updatedByName: actorOf(actor).name },
    ]);
    return toCustomerDto(created.toObject ? created.toObject({ transform: false }) : created);
  } catch (err) {
    if (isDuplicateKey(err)) return nameClash(name).then(() => { throw ApiError.conflict(`A customer named "${name}" already exists`, [{ field: "name", message: "Name already exists" }]); });
    throw err;
  }
};

/** Idempotent: returns the built-in internal customer, creating it the first time. Owner action; never runs on its own. */
export const ensureInternalCustomer = async (actor) => {
  const find = async () => (await Customer.find({ kind: CUSTOMER_KIND.INTERNAL }).lean())[0];
  const existing = await find();
  if (existing) return { customer: toCustomerDto(existing), created: false };
  const [clash] = await Customer.find({ customerKey: INTERNAL_KEY }).lean();
  if (clash) throw ApiError.conflict(`A customer named "${clash.name}" already exists and is not the built-in internal customer. Rename it before enabling the internal customer`);
  try {
    const [created] = await Customer.insertMany([
      { name: INTERNAL_CUSTOMER_NAME, customerKey: INTERNAL_KEY, kind: CUSTOMER_KIND.INTERNAL, revision: 1, history: [historyRow(CUSTOMER_HISTORY.CREATE, actor, 1, "Built-in internal customer")], isDeleted: false, createdBy: actorOf(actor).id, createdByName: actorOf(actor).name, updatedBy: actorOf(actor).id, updatedByName: actorOf(actor).name },
    ]);
    return { customer: toCustomerDto(created.toObject ? created.toObject({ transform: false }) : created), created: true };
  } catch (err) {
    if (!isDuplicateKey(err)) throw err;
    const again = await find(); // a parallel request created it first
    if (again) return { customer: toCustomerDto(again), created: false };
    throw err;
  }
};

export const updateCustomer = async (id, body, actor) => {
  const customer = await loadCustomer(id);
  refuseInternal(customer, "edited");
  if (customer.isDeleted) throw ApiError.conflict("This customer is archived. Restore it before editing");
  if (body.revision !== undefined && body.revision !== customer.revision) throw ApiError.conflict("This customer was changed by someone else. Reload and try again");
  const name = body.name === undefined ? customer.name : normalizeText(body.name);
  if (textKey(name) === INTERNAL_KEY) throw ApiError.conflict(`"${INTERNAL_CUSTOMER_NAME}" is reserved for the built-in internal customer`, [{ field: "name", message: "This name is reserved" }]);
  await nameClash(name, id);
  const next = { name, customerKey: textKey(name) };
  for (const k of ["address", "gstin", "stateName", "stateCode", "contact"]) next[k] = body[k] === undefined ? customer[k] ?? "" : body[k];
  const revision = customer.revision + 1;
  let result;
  try {
    result = await Customer.updateOne({ _id: id, revision: customer.revision, isDeleted: false }, { $set: { ...next, revision, updatedBy: actorOf(actor).id, updatedByName: actorOf(actor).name }, $push: { history: historyRow(CUSTOMER_HISTORY.UPDATE, actor, revision) } });
  } catch (err) {
    if (isDuplicateKey(err)) throw ApiError.conflict(`A customer named "${name}" already exists`, [{ field: "name", message: "Name already exists" }]);
    throw err;
  }
  if (!result.matchedCount) throw ApiError.conflict("This customer was changed by someone else. Reload and try again");
  return getCustomer(id);
};

/**
 * Concurrency guard for everything that creates or reserves a Pheera for a customer (new Pheera, draft from Pheeras, add to draft,
 * re-bill, assign customer). Call it INSIDE the transaction, before the Pheera is written. It is a real WRITE to the customer document
 * (conditional on "not archived"), so it conflicts with archiving that same customer instead of trusting an earlier read: whichever
 * transaction commits second is retried by MongoDB and then sees the other one's result. Ids are visited in sorted order.
 */
export const assertCustomersActive = async (customerIds, session = null) => {
  for (const id of [...new Set(customerIds.map(String))].sort()) {
    const result = await Customer.updateOne({ _id: id, isDeleted: false }, { $inc: { lockVersion: 1 } }, { session: session ?? undefined, timestamps: false });
    if (result.matchedCount) continue;
    const [found] = await Customer.find({ _id: id }).lean();
    if (!found) throw ApiError.notFound("Customer not found");
    const message = `Customer "${found.name}" is archived. Restore the customer first`;
    throw ApiError.conflict(message, [{ field: "customerId", message }]);
  }
};

/**
 * Archive. The archive write comes FIRST and the check for Pheeras reserved in a draft is made afterwards, in the same transaction,
 * so a draft that is being created at the same moment cannot slip through between a check and the write. Ordinary UNBILLED, BILLED and
 * NOT_BILLABLE Pheeras do not block archiving.
 */
export const archiveCustomer = async (id, { reason }, actor) => {
  const customer = await loadCustomer(id);
  refuseInternal(customer, "archived");
  if (customer.isDeleted) throw ApiError.conflict("This customer is already archived");
  const revision = customer.revision + 1;
  const blocked = () => ApiError.conflict("Pheera of this customer are in a draft bill. Finish or discard that draft first");
  await runInTransaction(async (session) => {
    const options = session ? { session } : undefined;
    const result = await Customer.updateOne(
      { _id: id, revision: customer.revision, isDeleted: false },
      { $set: { isDeleted: true, deletedAt: new Date(), deletedBy: actorOf(actor).name, deletedReason: reason, revision, updatedBy: actorOf(actor).id, updatedByName: actorOf(actor).name }, $inc: { lockVersion: 1 }, $push: { history: historyRow(CUSTOMER_HISTORY.ARCHIVE, actor, revision, reason) } },
      options
    );
    if (!result.matchedCount) throw ApiError.conflict("This customer was changed by someone else. Reload and try again");
    const held = await TruckTrip.find({ customerId: String(id), billingStatus: BILLING_STATUS.RESERVED, isDeleted: false }).session(session).limit(1).lean();
    if (held.length) {
      // In a transaction this throw rolls the archive back. Without one (standalone MongoDB) undo it by hand.
      if (!session) await Customer.updateOne({ _id: id, revision, isDeleted: true }, { $set: { isDeleted: false, deletedAt: null, deletedBy: null, deletedReason: null, revision: customer.revision }, $pop: { history: 1 } });
      throw blocked();
    }
  });
  return getCustomer(id);
};

/** The explicit decision to bring an archived customer back (the only way an archived name becomes active again). */
export const restoreCustomer = async (id, { reason = null } = {}, actor) => {
  const customer = await loadCustomer(id);
  if (!customer.isDeleted) throw ApiError.conflict("This customer is not archived");
  const revision = customer.revision + 1;
  const result = await Customer.updateOne({ _id: id, revision: customer.revision, isDeleted: true }, { $set: { isDeleted: false, deletedAt: null, deletedBy: null, deletedReason: null, revision, updatedBy: actorOf(actor).id, updatedByName: actorOf(actor).name }, $push: { history: historyRow(CUSTOMER_HISTORY.RESTORE, actor, revision, reason) } });
  if (!result.matchedCount) throw ApiError.conflict("This customer was changed by someone else. Reload and try again");
  return getCustomer(id);
};
