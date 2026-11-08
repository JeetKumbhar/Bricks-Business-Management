import { BILLING_ACTION, BILLING_STATUS } from "../constants/billing.js";
import { BILL_STATUS } from "../constants/bill.js";
import Bill from "../models/Bill.js";
import TruckTrip from "../models/TruckTrip.js";
import ApiError from "../utils/ApiError.js";

// Low-level, atomic billing-status changes of Pheeras. Every function is ONE conditional updateMany: the filter names the status a
// Pheera must be in, so a Pheera that someone else changed a moment ago simply does not match, and the caller compares the modified
// count with what it expected. This conditional update (not any button state) is what makes double billing impossible.
// Ids are passed as strings; Mongoose casts them.
const ids = (list) => list.map(String);
const entry = (action, actor, extra = {}) => ({ action, at: new Date(), by: actor?.name ?? "Unknown", byId: actor?.id ?? null, billId: null, billNumber: null, reason: null, ...extra });
const opts = (session) => (session ? { session } : {});

/** UNBILLED (this customer) -> RESERVED by `billId`. Returns how many were reserved. */
export const reserveTrips = async ({ tripIds, customerId, billId, actor, session }) => {
  const result = await TruckTrip.updateMany(
    { _id: { $in: ids(tripIds) }, customerId: String(customerId), billingStatus: BILLING_STATUS.UNBILLED, isDeleted: false },
    { $set: { billingStatus: BILLING_STATUS.RESERVED, billId: String(billId), reservedAt: new Date() }, $push: { billingHistory: entry(BILLING_ACTION.RESERVED, actor, { billId: String(billId), customerId: String(customerId) }) } },
    opts(session)
  );
  return result.modifiedCount;
};

/** RESERVED by `billId` -> UNBILLED (a line was removed, or the draft was discarded). */
export const releaseTrips = async ({ tripIds, billId, actor, reason, session }) => {
  const result = await TruckTrip.updateMany(
    { _id: { $in: ids(tripIds) }, billId: String(billId), billingStatus: BILLING_STATUS.RESERVED },
    { $set: { billingStatus: BILLING_STATUS.UNBILLED, billId: null, reservedAt: null }, $push: { billingHistory: entry(BILLING_ACTION.RELEASED, actor, { billId: String(billId), reason }) } },
    opts(session)
  );
  return result.modifiedCount;
};

/** RESERVED by `billId` -> BILLED (the draft was finalized). Returns how many were marked. */
export const markBilled = async ({ billId, billNumber, actor, session }) => {
  const result = await TruckTrip.updateMany(
    { billId: String(billId), billingStatus: BILLING_STATUS.RESERVED, isDeleted: false },
    { $set: { billingStatus: BILLING_STATUS.BILLED, billedAt: new Date() }, $push: { billingHistory: entry(BILLING_ACTION.BILLED, actor, { billId: String(billId), billNumber }) } },
    opts(session)
  );
  return result.modifiedCount;
};

/** The invoice was cancelled: its Pheeras stay BILLED (never auto-released); the trail records it. */
export const noteBillCancelled = async ({ billId, billNumber, reason, actor, session }) => {
  const result = await TruckTrip.updateMany(
    { billId: String(billId), billingStatus: BILLING_STATUS.BILLED },
    { $push: { billingHistory: entry(BILLING_ACTION.BILL_CANCELLED, actor, { billId: String(billId), billNumber, reason }) } },
    opts(session)
  );
  return result.modifiedCount;
};

/** Re-billing: BILLED on a cancelled invoice -> RESERVED on the new correction draft, in one step. Keeps the cancelled invoice reference. */
export const moveTrips = async ({ tripIds, fromBillId, fromBillNumber, toBillId, customerId, actor, session }) => {
  const result = await TruckTrip.updateMany(
    { _id: { $in: ids(tripIds) }, billId: String(fromBillId), billingStatus: BILLING_STATUS.BILLED, customerId: String(customerId), isDeleted: false },
    {
      $set: { billingStatus: BILLING_STATUS.RESERVED, billId: String(toBillId), reservedAt: new Date(), billedAt: null },
      $push: { billingHistory: entry(BILLING_ACTION.REBILLED, actor, { billId: String(toBillId), previousBillId: String(fromBillId), previousBillNumber: fromBillNumber, reason: `Re-billed from cancelled invoice ${fromBillNumber}` }) },
    },
    opts(session)
  );
  return result.modifiedCount;
};

/** Puts moved Pheeras back on the cancelled invoice (only used to undo a half-finished move when there is no transaction). */
export const undoMove = async ({ tripIds, fromBillId, toBillId, actor }) =>
  TruckTrip.updateMany(
    { _id: { $in: ids(tripIds) }, billId: String(toBillId), billingStatus: BILLING_STATUS.RESERVED },
    { $set: { billingStatus: BILLING_STATUS.BILLED, billId: String(fromBillId), reservedAt: null }, $push: { billingHistory: entry(BILLING_ACTION.RELEASED, actor, { billId: String(toBillId), reason: "Re-billing could not be completed and was undone" }) } }
  ).then((r) => r.modifiedCount);

/** Why a RESERVED or BILLED Pheera cannot be changed, naming the invoice. */
export const lockedError = async (trip, what = "changed") => {
  const [bill] = trip.billId ? await Bill.find({ _id: String(trip.billId) }).lean() : [];
  if (trip.billingStatus === BILLING_STATUS.RESERVED) return ApiError.conflict(`This Pheera is reserved in a draft bill and cannot be ${what}. Remove it from the draft bill first`);
  const ref = bill?.billNumber ? `invoice ${bill.billNumber}` : "an invoice";
  const tail = bill?.status === BILL_STATUS.CANCELLED ? ` That invoice is cancelled: release the Pheera (with a reason) or re-bill it from the cancelled invoice first` : ` Cancel that invoice first`;
  return ApiError.conflict(`This Pheera is billed on ${ref} and cannot be ${what}.${tail}`);
};
